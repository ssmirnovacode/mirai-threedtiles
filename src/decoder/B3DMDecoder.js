import { BufferAttribute, InstancedMesh, Matrix4 } from 'three';
import { FeatureTable, BatchTable } from './FeatureTable';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

class B3DMDecoder {
  constructor(aGltfLoader) {
    this.gltfLoader = aGltfLoader;
    this.tempMatrix = new Matrix4();

    this.zUpToYUpMatrix = new Matrix4();
    this.zUpToYUpMatrix.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  }

  parseB3DM(arrayBuffer, meshCallback, sceneZupToYUp, meshZUpToYUp) {
    const self = this;
    const dataView = new DataView(arrayBuffer);

    const magic =
      String.fromCharCode(dataView.getUint8(0)) +
      String.fromCharCode(dataView.getUint8(1)) +
      String.fromCharCode(dataView.getUint8(2)) +
      String.fromCharCode(dataView.getUint8(3));
    console.assert(magic === 'b3dm');

    const byteLength = dataView.getUint32(8, true);
    console.assert(byteLength === arrayBuffer.byteLength);

    const featureTableJSONByteLength = dataView.getUint32(12, true);
    const featureTableBinaryByteLength = dataView.getUint32(16, true);
    const batchTableJSONByteLength = dataView.getUint32(20, true);
    const batchTableBinaryByteLength = dataView.getUint32(24, true);

    const featureTableStart = 28;
    const featureTable = new FeatureTable(
      arrayBuffer,
      featureTableStart,
      featureTableJSONByteLength,
      featureTableBinaryByteLength,
    );

    const batchTableStart = featureTableStart + featureTableJSONByteLength + featureTableBinaryByteLength;
    const batchTable = new BatchTable(
      arrayBuffer,
      featureTable.getData('BATCH_LENGTH'),
      batchTableStart,
      batchTableJSONByteLength,
      batchTableBinaryByteLength,
    );

    const glbStart = batchTableStart + batchTableJSONByteLength + batchTableBinaryByteLength;
    const glbBytes = new Uint8Array(arrayBuffer, glbStart, byteLength - glbStart);

    const gltfBuffer = glbBytes.slice().buffer;

    return new Promise(async (resolve, reject) => {
      await this.checkLoaderInitialized();
      this.gltfLoader.parse(
        gltfBuffer,
        null,
        model => {
          const rtcCenter = featureTable.getData('RTC_CENTER');
          if (rtcCenter) {
            this.tempMatrix.makeTranslation(rtcCenter[0], rtcCenter[1], rtcCenter[2]);
            model.scene.applyMatrix4(this.tempMatrix);
          } else if (!!model.userData.gltfExtensions && !!model.userData.gltfExtensions.CESIUM_RTC) {
            this.tempMatrix.makeTranslation(
              model.userData.gltfExtensions.CESIUM_RTC.center[0],
              model.userData.gltfExtensions.CESIUM_RTC.center[1],
              model.userData.gltfExtensions.CESIUM_RTC.center[2],
            );
            model.scene.applyMatrix4(this.tempMatrix);
          }

          if (sceneZupToYUp) {
            model.scene.applyMatrix4(self.zUpToYUpMatrix);
          }
          model.scene.asset = model.asset;
          model.scene.traverse(o => {
            if (o.isMesh) {
              if (meshZUpToYUp) {
                o.applyMatrix4(self.zUpToYUpMatrix);
              }
              if (!!meshCallback) {
                meshCallback(o);
              }
            }
          });
          resolve(model.scene);
        },
        error => {
          console.error(error);
        },
      );
    });
  }

  checkLoaderInitialized = async () => {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (
          (!this.gltfLoader.hasDracoLoader || this.gltfLoader.dracoLoader) &&
          (!this.gltfLoader.hasKTX2Loader || this.gltfLoader.ktx2Loader)
        ) {
          clearInterval(interval);
          resolve();
        }
      }, 10); // check every 100ms
    });
  };
  parseB3DMInstanced(arrayBuffer, meshCallback, maxCount, sceneZupToYUp, meshZupToYup) {
    // expects GLTF with one node level

    return this.parseB3DM(arrayBuffer, meshCallback, sceneZupToYUp, meshZupToYup).then(mesh => {
      // todo several meshes in a single gltf
      let instancedMesh;
      let geometries = [];
      let materials = [];
      mesh.updateWorldMatrix(false, true);
      mesh.traverse(child => {
        if (child.isMesh) {
          child.geometry.applyMatrix4(child.matrixWorld);
          geometries.push(child.geometry);
          materials.push(child.material);
        }
      });
      let mergedGeometry = normalizeAndMergeGeometries(geometries);
      instancedMesh = new InstancedMesh(mergedGeometry, materials, maxCount);
      instancedMesh.baseMatrix = new Matrix4().identity();
      return instancedMesh;
    });
  }
}
export { B3DMDecoder };

function normalizeAndMergeGeometries(geometries) {
  // Identify all unique attributes across all geometries.
  let allAttributes = new Set();
  geometries.forEach(geometry => {
    for (let attribute in geometry.attributes) {
      allAttributes.add(attribute);
    }
  });

  // Ensure every geometry has every attribute, adding default filled ones if necessary.
  geometries.forEach(geometry => {
    allAttributes.forEach(attribute => {
      if (!geometry.attributes[attribute]) {
        const attributeSize = getAttributeSize(attribute);
        const buffer = new Float32Array(attributeSize * geometry.getAttribute('position').count).fill(0);
        geometry.setAttribute(attribute, new BufferAttribute(buffer, attributeSize));
      }
    });
  });

  // Now merge the geometries.
  let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true);
  return mergedGeometry;
}

function getAttributeSize(attribute) {
  switch (attribute) {
    case 'position':
    case 'normal':
    case 'color':
      return 3;
    case 'uv':
    case 'uv2':
      return 2;
    // Add other attribute cases as needed.
    default:
      throw new Error(`Unknown attribute ${attribute}`);
  }
}

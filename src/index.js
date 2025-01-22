import {
  AmbientLight,
  Color,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { OGC3DTile } from './tileset/OGC3DTile';
import { TileLoader } from './tileset/TileLoader';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OcclusionCullingService } from './tileset/OcclusionCullingService';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Sky } from 'three/addons/objects/Sky';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader';
import { Scene } from '../../../twin-app/libs/fe/scene2/src';

let paused = false;

const occlusionCullingService = new OcclusionCullingService();
occlusionCullingService.setSide(DoubleSide);
const scene = initScene();

const raycaster = new Raycaster();
raycaster.params.Points.threshold = 0.002;
const pointer = new Vector2();
const geometry = new SphereGeometry(0.02, 32, 16);
const material = new MeshBasicMaterial({ color: 0xffff00 });
const sphere = new Mesh(geometry, material);
material.transparent = true;
material.opacity = 0.5;
sphere.renderOrder = 1;
scene.add(sphere);
window.addEventListener('pointermove', event => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

const domContainer = initDomContainer('screen');
const camera = initCamera(domContainer.offsetWidth, domContainer.offsetHeight);
const stats = initStats(domContainer);
const renderer = initRenderer(camera, domContainer);

const tileLoader = initTileLoader();
let ogc3DTiles = initTilesets(scene, tileLoader, 'INCREMENTAL', 1.0, 1.0);
//let google = initGoogleTileset(scene, tileLoader, "INCREMENTAL", 0.5, 1.0);

let targetFrameRate = _isMobileDevice() ? 30 : 5000;
initSliders();
//const tileLoader = createInstancedTileLoader(scene);
//initInstancedTilesets(tileLoader);

function initSliders() {
  const lodSlider = document.getElementById('lodMultiplier');
  const lodSliderValue = document.getElementById('multiplierValue');

  lodSlider.addEventListener('input', e => {
    lodSliderValue.innerText = lodSlider.value;
    ogc3DTiles.forEach(tileset => {
      tileset.setGeometricErrorMultiplier(lodSlider.value);
    });
  });
}

function reloadTileset(loadingStrategy, geometricErrorMultiplier, distanceBias) {
  ogc3DTiles.forEach(tileset => {
    scene.remove(tileset);
    tileset.dispose();
  });

  tileLoader.clear();
  ogc3DTiles = initTilesets(scene, tileLoader, loadingStrategy, geometricErrorMultiplier, distanceBias);
}

function initTileLoader() {
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath('https://storage.googleapis.com/ogc-3d-tiles/basis/').detectSupport(renderer);
  const tileLoader = new TileLoader({
    renderer: renderer,
    //ktx2Loader:ktx2Loader,
    maxCachedItems: 200,
    meshCallback: (mesh, geometricError) => {
      mesh.material.wireframe = false;
      mesh.onAfterRender = () => {
        /* if(mesh.geometry.attributes.position) mesh.geometry.attributes.position.data.array = null
                if(mesh.geometry.attributes.uv) mesh.geometry.attributes.position.data.array = null
                if(mesh.geometry.attributes.normal) mesh.geometry.attributes.position.data.array = null
                if(mesh.material.map) mesh.material.map.mipmaps = null; */
      };
    },
    pointsCallback: (points, geometricError) => {
      points.material.size = Math.min(1.0, 0.1 * Math.sqrt(geometricError));
      points.material.sizeAttenuation = true;
    },
  });
  return tileLoader;
}

// Optional: Provide a DRACOLoader instance to decode compressed mesh data

const controller = initController(camera, domContainer);

const composer = initComposer(scene, camera, renderer);
let previousFrame = performance.now();
animate();

let sky, sun;
initSky();
function initSky() {
  sky = new Sky();
  sky.scale.setScalar(450000);
  scene.add(sky);

  sun = new Vector3();

  const effectController = {
    turbidity: 0.1,
    rayleigh: 0.1,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.3,
    elevation: 80,
    azimuth: 20,
    exposure: renderer.toneMappingExposure,
  };

  const uniforms = sky.material.uniforms;
  uniforms['turbidity'].value = effectController.turbidity;
  uniforms['rayleigh'].value = effectController.rayleigh;
  uniforms['mieCoefficient'].value = effectController.mieCoefficient;
  uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

  const phi = MathUtils.degToRad(90 - effectController.elevation);
  const theta = MathUtils.degToRad(effectController.azimuth);

  sun.setFromSphericalCoords(1, phi, theta);

  uniforms['sunPosition'].value.copy(sun);

  renderer.toneMappingExposure = effectController.exposure;
  renderer.render(scene, camera);
}
function initComposer(scene, camera, renderer) {
  const renderScene = new RenderPass(scene, camera);

  const composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  //composer.addPass(bloomPass);
  return composer;
}
function initScene() {
  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  scene.background = new Color(0xffffff);

  scene.add(new AmbientLight(0xffffff, 3.0));

  return scene;
}

function initDomContainer(divID) {
  const domContainer = document.getElementById(divID);
  domContainer.style = 'position: absolute; height:100%; width:100%; left: 0px; top:0px;';
  document.body.appendChild(domContainer);
  return domContainer;
}

function initRenderer(camera, dom) {
  const renderer = new WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.maxSamples = 0;
  renderer.setSize(dom.offsetWidth, dom.offsetHeight);
  renderer.outputColorSpace = SRGBColorSpace;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.autoClear = false;

  dom.appendChild(renderer.domElement);

  onWindowResize();
  window.addEventListener('resize', onWindowResize);
  function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    renderer.setSize(dom.offsetWidth, dom.offsetHeight);
  }

  return renderer;
}

function initStats(dom) {
  const stats = Stats();
  document.body.appendChild(stats.dom);
  return stats;
}

function initTilesets(scene, tileLoader, loadingStrategy, geometricErrorMultiplier, distanceBias) {
  /* const ogc3DTile = new OGC3DTile({

        //url: "https://storage.googleapis.com/ogc-3d-tiles/playaSquarePack/tileset.json",
        //url: "https://s3.us-east-2.wasabisys.com/construkted-assets/a8cpnqtyjb2/tileset.json", //ION
        //url: "https://s3.us-east-2.wasabisys.com/construkted-assets/ayj1tydhip1/tileset.json", //UM
        //url: "https://storage.googleapis.com/ogc-3d-tiles/splatsMirai/tileset.json", //UM
        //url: "https://vectuel-3d-models.s3.eu-west-3.amazonaws.com/DAE/SM/B/tileset.json", //UM
        // url: "https://storage.googleapis.com/ogc-3d-tiles/cabinSplats/tileset.json", //UM
        url: "https://storage.googleapis.com/ogc-3d-tiles/voluma/sectorA/tileset.json", //UM

        geometricErrorMultiplier: 0.4,
        distanceBias: 1,
        loadOutsideView: true,
        tileLoader: tileLoader,
        static: false,
        centerModel: false,
        //loadingStrategy: "IMMEDIATE",
        distanceBias: distanceBias,
        drawBoundingVolume: false,
        //renderer: renderer,
        onLoadCallback: (e) => {
            console.log(e)
        }

    });
    ogc3DTile.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI * 0.5);
    ogc3DTile.updateMatrices();
    ogc3DTile.setSplatsCropRadius(500);
    scene.add(ogc3DTile); */

  const ogc3DTile2 = new OGC3DTile({
    //url: "https://storage.googleapis.com/ogc-3d-tiles/playaSquarePack/tileset.json",
    //url: "https://s3.us-east-2.wasabisys.com/construkted-assets/a8cpnqtyjb2/tileset.json", //ION
    //url: "https://s3.us-east-2.wasabisys.com/construkted-assets/ayj1tydhip1/tileset.json", //UM
    //url: "https://storage.googleapis.com/ogc-3d-tiles/splatsMirai/tileset.json", //UM
    //url: "https://vectuel-3d-models.s3.eu-west-3.amazonaws.com/DAE/SM/B/tileset.json", //UM
    // url: "https://storage.googleapis.com/ogc-3d-tiles/cabinSplats/tileset.json", //UM
    //url: "https://storage.googleapis.com/ogc-3d-tiles/voluma/maximap/tileset.json", //UM
    url: 'http://localhost:8082/tileset.json', //UM

    geometricErrorMultiplier: 0.4,
    distanceBias: 1,
    loadOutsideView: false,
    tileLoader: tileLoader,
    static: false,
    centerModel: false,
    loadingStrategy: 'IMMEDIATE',
    distanceBias: distanceBias,
    drawBoundingVolume: false,
    //renderer: renderer,
    onLoadCallback: e => {
      console.log(e);
    },
  });
  //ogc3DTile2.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI * 0.5);
  //ogc3DTile2.position.set(2,0,0)
  //ogc3DTile2.scale.set(0.5,0.5,0.5)
  ogc3DTile2.updateMatrices();
  //ogc3DTile2.setSplatsCropRadius(500);
  scene.add(ogc3DTile2);
  //

  //const axesHelper = new THREE.AxesHelper( 5000 );
  //scene.add( axesHelper );

  return [ogc3DTile2];
}

function initCamera(width, height) {
  const camera = new PerspectiveCamera(60, width / height, 0.01, 1000);

  camera.position.set(1.5, 2, 2.5);

  camera.lookAt(0, 0, 0);

  camera.matrixAutoUpdate = true;

  document.addEventListener('keydown', function (event) {
    if (event.key === 'p') {
      paused = !paused;
    }
  });

  return camera;
}
function initController(camera, dom) {
  const controller = new OrbitControls(camera, dom);

  //controller.target.set(4629210.73133627, 435359.7901640832, 4351492.357788198);
  controller.target.set(0.5, -0.7, 0);

  controller.minDistance = 0;
  controller.maxDistance = 30000;
  controller.autoRotate = false;
  const checkbox = document.getElementById('autorotate');
  /* checkbox.addEventListener("click", () => {
        controller.autoRotate = checkbox.checked;
    }) */
  controller.update();
  return controller;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = performance.now() - previousFrame;
  if (delta < 1000 / targetFrameRate) {
    return;
  }
  previousFrame = performance.now();
  /*  lon+=0.000001;
     t++;
     if(t%400 == 0){
         ogc3DTiles.position.copy(llhToCartesianFast(lon, 53.392, 0));
         ogc3DTiles.updateMatrices();
     } */

  if (!paused) {
    tileLoader.update();
    ogc3DTiles.forEach(tileset => {
      tileset.update(camera);
    });

    /* const info = ogc3DTiles.update(camera);
        infoTilesToLoad.innerText = info.numTilesLoaded
        infoTilesRendered.innerText = info.numTilesRendered
        infoMaxLOD.innerText = info.maxLOD
        infoPercentage.innerText = (info.percentageLoaded * 100).toFixed(1); */
    controller.update();

    raycaster.setFromCamera(pointer, camera);

    // calculate objects intersecting the picking ray
    const a = [];
    let intersects = raycaster.intersectObject(ogc3DTiles[0], true, a);

    if (intersects.length > 0) {
      sphere.position.copy(intersects[0].point);
    } /* else{
            intersects = raycaster.intersectObject(ogc3DTiles[1], true, a);
            if(intersects.length>0){
                sphere.position.copy(intersects[0].point);
            }
        } */
    /* for (let i = 0; i < intersects.length; i++) {
            console.log(intersects[i]);
            sphere.position.set()
        } */
  }

  /* let c = 0;
    google.traverse(e=>{
        if(!!e.geometry){
            c++;
        }
    })
    console.log("jhgkjgh " + c)
    if(!paused){
        console.log(google.update(camera));
    }
    console.log(getOGC3DTilesCopyrightInfo()) */
  composer.render();
  stats.update();
}

function _isMobileDevice() {
  return typeof window.orientation !== 'undefined' || navigator.userAgent.indexOf('IEMobile') !== -1;
}

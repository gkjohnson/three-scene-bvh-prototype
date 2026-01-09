import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { MeshBVHHelper } from 'three-mesh-bvh';
import { computeSceneBoundsTree, disposeSceneBoundsTree, acceleratedSceneRaycast } from '../src/ExtensionUtilities.js';

// Extend Three.js Object3D prototype with scene BVH methods
THREE.Object3D.prototype.computeSceneBoundsTree = computeSceneBoundsTree;
THREE.Object3D.prototype.disposeSceneBoundsTree = disposeSceneBoundsTree;

const bgColor = 0x131619;
const params = {
	bvh: {
		enabled: true,
		visualize: false,
		depth: 15,
		displayParents: false,
		precise: false,
	},
	raycast: {
		firstHitOnly: true,
	},
};

let renderer, scene, camera, controls, stats;
let sphereContainer, sceneBVH, bvhHelper;
let raycaster, mouse, highlightMesh;
let infoElement;

init();
updateFromOptions();

function init() {

	infoElement = document.getElementById( 'info' );

	// Renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	// Scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 0, 10 )

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light.position.set( 1, 2, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 1 ) );

	// Camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( 0, 0, 20 );
	camera.updateProjectionMatrix();

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Container for all spheres
	sphereContainer = new THREE.Group();
	scene.add( sphereContainer );

	// Raycaster
	raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = params.raycast.firstHitOnly;
	mouse = new THREE.Vector2();

	// Highlight sphere
	highlightMesh = new THREE.Mesh( new THREE.SphereGeometry( 0.1, 16, 16 ), new THREE.MeshBasicMaterial( {
		color: 0xffff00,
		transparent: true,
		opacity: 0.75,
		fog: false,
	} ) );
	highlightMesh.visible = false;
	scene.add( highlightMesh );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new GUI();

	const bvhFolder = gui.addFolder( 'Scene BVH' );
	bvhFolder.add( params.bvh, 'enabled' ).onChange( updateBVH );
	bvhFolder.add( params.bvh, 'precise' ).onChange( updateBVH );

	const helperFolder = gui.addFolder( 'BVH Helper' );
	helperFolder.add( params.bvh, 'visualize' ).name( 'enabled' );
	helperFolder.add( params.bvh, 'displayParents' ).onChange( v => {

		bvhHelper.displayParents = v;
		bvhHelper.update();

	} );
	helperFolder.add( params.bvh, 'depth' ).min( 1 ).max( 20 ).step( 1 ).onChange( v => {

		bvhHelper.depth = v;
		bvhHelper.update();

	} );
	bvhFolder.open();

	const raycastFolder = gui.addFolder( 'Raycast' );
	raycastFolder.add( params.raycast, 'firstHitOnly' ).onChange( () => {

		raycaster.firstHitOnly = params.raycast.firstHitOnly;

	} );
	raycastFolder.open();

	// Event listeners
	window.addEventListener( 'resize', onWindowResize, false );
	window.addEventListener( 'pointermove', onPointerMove, false );

}

function createSpheres() {

	// Clear existing spheres
	while ( sphereContainer.children.length ) {

		const child = sphereContainer.children[ 0 ];
		child.material.dispose();
		child.geometry.dispose();
		sphereContainer.remove( child );

	}

	// Create geometry and materials
	const geometry = new THREE.TorusKnotGeometry();
	const geometries = [
		new THREE.TorusGeometry( 0.25, 0.1, 50, 100 ),
		new THREE.SphereGeometry( 0.25, 50, 50 ),
	];

	const materials = [
		new THREE.MeshStandardMaterial( { color: 0xe91e63 } ),
		new THREE.MeshStandardMaterial( { color: 0x2196f3 } ),
		new THREE.MeshStandardMaterial( { color: 0x4caf50 } ),
		new THREE.MeshStandardMaterial( { color: 0xff9800 } ),
		new THREE.MeshStandardMaterial( { color: 0x9c27b0 } ),
	];

	// Create spheres in a random distribution
	for ( let i = 0; i < 7500; i ++ ) {

		const material = materials[ i % materials.length ];
		const geometry = geometries[ i % geometries.length ];
		const mesh = new THREE.Mesh( geometry, material );

		// Random position
		const d = Math.sqrt( Math.random() );
		mesh.position.randomDirection().multiplyScalar( 10 * d * d );

		// Random rotation for variety
		mesh.rotation.set(
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI
		);

		mesh.scale.setScalar( 0.25 + 0.75 * Math.random() );

		sphereContainer.add( mesh );

	}

}

function updateBVH() {

	// Dispose existing BVH
	if ( sceneBVH ) {

		sphereContainer.disposeSceneBoundsTree();
		sceneBVH = null;

		bvhHelper.dispose();
		scene.remove( bvhHelper );
		bvhHelper = null;


	}

	// Create new BVH if enabled
	if ( params.bvh.enabled ) {

		console.time( 'Building Scene BVH' );
		sphereContainer.updateMatrixWorld();

		sphereContainer.computeSceneBoundsTree( {
			precise: params.bvh.precise,
			maxLeafSize: 1,
		} );
		sphereContainer.raycast = acceleratedSceneRaycast;
		sceneBVH = sphereContainer.sceneBoundsTree;
		console.timeEnd( 'Building Scene BVH' );

		bvhHelper = new MeshBVHHelper( sphereContainer, sphereContainer.sceneBoundsTree, params.bvh.depth );
		bvhHelper.color.set( 0xffffff );
		bvhHelper.opacity = 0.5;
		bvhHelper.displayParents = params.bvh.displayParents;
		bvhHelper.update();
		scene.add( bvhHelper );

	}

}

function updateFromOptions() {

	createSpheres();
	updateBVH();

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function onPointerMove( event ) {

	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

}

function performRaycast() {

	raycaster.setFromCamera( mouse, camera );

	let intersects = [];
	let raycastTime = 0;

	// Raycast using Scene BVH if enabled
	const startTime = performance.now();
	intersects = raycaster.intersectObject( sphereContainer, true );
	raycastTime = performance.now() - startTime;
	infoElement.innerText = `${ raycastTime.toFixed( 3 ) }ms`;

	// Highlight intersected object
	if ( intersects.length > 0 ) {

		const firstHit = intersects[ 0 ];
		highlightMesh.position.copy( firstHit.point );
		highlightMesh.visible = true;

	} else {

		highlightMesh.visible = false;

	}

}

function render() {

	stats.begin();

	controls.update();
	performRaycast();

	if ( bvhHelper ) {

		bvhHelper.depth = params.bvh.depth;
		bvhHelper.displayParents = params.bvh.displayParents;
		bvhHelper.visible = params.bvh.visualize;

	}

	scene.fog.near = camera.position.length() - 7.5;
	scene.fog.far = camera.position.length() + 5;
	renderer.render( scene, camera );

	stats.end();

}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { AVERAGE, CENTER, MeshBVHHelper, SAH } from 'three-mesh-bvh';
import { computeSceneBoundsTree, disposeSceneBoundsTree, acceleratedSceneRaycast } from '../src/ExtensionUtilities.js';

// Extend Three.js Object3D prototype with scene BVH methods
THREE.Object3D.prototype.computeSceneBoundsTree = computeSceneBoundsTree;
THREE.Object3D.prototype.disposeSceneBoundsTree = disposeSceneBoundsTree;

const bgColor = 0x131619;
const params = {
	mode: 'batched',
	animate: true,
	bvh: {
		enabled: true,
		strategy: CENTER,
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
let lastTime = performance.now();
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
	scene.fog = new THREE.Fog( bgColor, 0, 10 );

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light.position.set( 1, 2, 1 );

	const revLight = new THREE.DirectionalLight( 0xffffff, 0.75 );
	revLight.position.set( 1, 2, 1 ).multiplyScalar( - 1 );
	scene.add( light, revLight );
	scene.add( new THREE.AmbientLight( 0xffffff, .75 ) );

	// Camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( 18, 10, 0 );

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

	gui.add( params, 'mode', [ 'group', 'instanced', 'batched', 'mix' ] ).onChange( updateFromOptions );
	gui.add( params, 'animate' );

	const bvhFolder = gui.addFolder( 'Scene BVH' );
	bvhFolder.add( params.bvh, 'enabled' ).onChange( updateBVH );
	bvhFolder.add( params.bvh, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( updateBVH );
	bvhFolder.add( params.bvh, 'precise' ).onChange( updateBVH );

	const helperFolder = gui.addFolder( 'BVH Helper' );
	helperFolder.add( params.bvh, 'visualize' ).name( 'enabled' );
	helperFolder.add( params.bvh, 'displayParents' ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.displayParents = v;
			bvhHelper.update();

		}

	} );
	helperFolder.add( params.bvh, 'depth' ).min( 1 ).max( 20 ).step( 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );
	bvhFolder.add( params.raycast, 'firstHitOnly' ).onChange( () => {

		raycaster.firstHitOnly = params.raycast.firstHitOnly;

	} );
	bvhFolder.open();

	// Event listeners
	window.addEventListener( 'resize', onWindowResize, false );
	window.addEventListener( 'pointermove', onPointerMove, false );

}

function createSpheres() {

	// Clear existing content
	while ( sphereContainer.children.length ) {

		const child = sphereContainer.children[ 0 ];
		child.material.dispose();
		child.geometry.dispose();

		if ( child.dispose ) {

			child.dispose();

		}

		sphereContainer.remove( child );

	}

	const count = 10000;
	const geometries = [
		new THREE.TorusGeometry( 0.25, 0.1, 30, 30 ),
		new THREE.SphereGeometry( 0.25, 30, 30 ),
	];

	const colors = [
		new THREE.Color( 0xE91E63 ),
		new THREE.Color( 0x03A9F4 ),
		new THREE.Color( 0x4CAF50 ),
		new THREE.Color( 0xFFC107 ),
		new THREE.Color( 0x9C27B0 ),
	];

	// Helper to generate random transform
	const _matrix = new THREE.Matrix4();
	const _position = new THREE.Vector3();
	const _rotation = new THREE.Euler();
	const _quaternion = new THREE.Quaternion();
	const _scale = new THREE.Vector3();

	let groupCount = 0;
	let instancedCount = 0;
	let batchedCount = 0;

	switch ( params.mode ) {

		case 'group':
			groupCount = count;
			break;
		case 'instanced':
			instancedCount = count;
			break;
		case 'batched':
			batchedCount = count;
			break;
		case 'mix':
			groupCount = Math.ceil( count / 3 );
			instancedCount = Math.ceil( count / 3 );
			batchedCount = Math.ceil( count / 3 );
			break;

	}


	if ( groupCount !== 0 ) {

		const materials = colors.map( c => new THREE.MeshStandardMaterial( { color: c } ) );

		// Create individual meshes in a group
		for ( let i = 0; i < groupCount; i ++ ) {

			const material = materials[ i % materials.length ];
			const geometry = geometries[ i % geometries.length ];
			const mesh = new THREE.Mesh( geometry, material );

			getRandomTransform( mesh.matrix );
			mesh.matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );

			sphereContainer.add( mesh );

		}

	}

	if ( instancedCount !== 0 ) {

		// Create InstancedMesh for each geometry type
		const material = new THREE.MeshStandardMaterial( { color: 0xFFFFFF } );
		geometries.forEach( geometry => {

			const c = Math.ceil( instancedCount / geometries.length );
			const instancedMesh = new THREE.InstancedMesh( geometry, material, c );

			for ( let i = 0; i < c; i ++ ) {

				getRandomTransform( _matrix );
				instancedMesh.setMatrixAt( i, _matrix );

				const colorIndex = i % colors.length;
				instancedMesh.setColorAt( i, colors[ colorIndex ] );

			}

			sphereContainer.add( instancedMesh );

		} );

	}

	if ( batchedCount !== 0 ) {

		// Create BatchedMesh
		const maxVertexCount = geometries.reduce( ( sum, g ) => sum + g.attributes.position.count, 0 );
		const maxIndexCount = geometries.reduce( ( sum, g ) => sum + ( g.index ? g.index.count : 0 ), 0 );
		const material = new THREE.MeshStandardMaterial( { color: 0xFFFFFF } );

		const batchedMesh = new THREE.BatchedMesh( batchedCount, maxVertexCount, maxIndexCount, material );

		// Add geometries
		const geometryIds = geometries.map( g => batchedMesh.addGeometry( g ) );

		// Add instances
		for ( let i = 0; i < batchedCount; i ++ ) {

			const geometryId = geometryIds[ i % geometries.length ];
			const instanceId = batchedMesh.addInstance( geometryId );
			const colorIndex = i % colors.length;

			getRandomTransform( _matrix );
			batchedMesh.setMatrixAt( instanceId, _matrix );
			batchedMesh.setColorAt( instanceId, colors[ colorIndex ] );

		}

		sphereContainer.add( batchedMesh );

	}

	function getRandomTransform( matrix ) {

		const d = Math.cbrt( Math.random() );
		_position.randomDirection().multiplyScalar( 10 * d * d );
		_rotation.set(
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI
		);
		_quaternion.setFromEuler( _rotation );
		_scale.setScalar( 0.25 + 0.75 * Math.random() );
		matrix.compose( _position, _quaternion, _scale );

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
			strategy: params.bvh.strategy,
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

	if ( params.animate ) {

		sphereContainer.rotation.y += ( performance.now() - lastTime ) * 1e-4 * 0.5;

	}

	lastTime = performance.now();

	scene.fog.near = camera.position.length() - 7.5;
	scene.fog.far = camera.position.length() + 5;
	renderer.render( scene, camera );

	stats.end();

}

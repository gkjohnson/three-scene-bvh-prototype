import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { CONTAINED, INTERSECTED, MeshBVHHelper } from 'three-mesh-bvh';
import { computeSceneBoundsTree, disposeSceneBoundsTree } from '../src/ExtensionUtilities.js';
import { StaticSceneBVH } from '../src/StaticSceneBVH.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Extend Three.js Object3D prototype with scene BVH methods
THREE.Object3D.prototype.computeSceneBoundsTree = computeSceneBoundsTree;
THREE.Object3D.prototype.disposeSceneBoundsTree = disposeSceneBoundsTree;

const bgColor = 0x131619;
const params = {
	animate: true,
	bvh: {
		visualize: false,
		depth: 25,
		displayParents: false,
	},
	frustumCulling: {
		useBVH: true,
	},
};

let renderer, scene, camera, controls, stats;
let container, sceneBVH, bvhHelper;
let batchedMesh;
let lastTime = performance.now();
let infoElement;

init();
createSpheres();

function init() {

	infoElement = document.getElementById( 'info' );

	// Renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	// Camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 18, 10, 0 );

	// Scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 25, camera.far );

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light.position.set( 1, 2, 1 );

	const revLight = new THREE.DirectionalLight( 0xffffff, 0.75 );
	revLight.position.set( 1, 2, 1 ).multiplyScalar( - 1 );
	scene.add( light, revLight );
	scene.add( new THREE.AmbientLight( 0xffffff, .75 ) );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Container for all objects
	// TODO: remove container
	container = new THREE.Group();
	scene.add( container );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new GUI();
	gui.add( params, 'animate' );

	const helperFolder = gui.addFolder( 'BVH Helper' );
	helperFolder.add( params.bvh, 'visualize' ).name( 'enabled' );
	helperFolder.add( params.bvh, 'displayParents' ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.displayParents = v;
			bvhHelper.update();

		}

	} );
	helperFolder.add( params.bvh, 'depth' ).min( 1 ).max( 25 ).step( 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );

	const frustumFolder = gui.addFolder( 'Frustum Culling' );
	frustumFolder.add( params.frustumCulling, 'useBVH' );

	// Event listeners
	window.addEventListener( 'resize', onWindowResize, false );

}

function updateVisible() {

	const { useBVH } = params.frustumCulling;
	batchedMesh.perObjectFrustumCulled = ! useBVH;
	for ( let i = 0, l = batchedMesh.instanceCount; i < l; i ++ ) {

		batchedMesh.setVisibleAt( i, ! useBVH );

	}

	if ( ! useBVH ) {

		return;

	}

	camera.updateMatrixWorld();

	// get the frustum
	const frustumMatrix = new THREE.Matrix4();
	const frustum = new THREE.Frustum();
	frustumMatrix
		.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
		.multiply( container.matrixWorld );
	frustum.setFromProjectionMatrix(
		frustumMatrix,
		camera.coordinateSystem,
		camera.reversedDepth
	);

	const point = new THREE.Vector3();
	sceneBVH.shapecast( {
		intersectsBounds: box => {

			if ( frustum.intersectsBox( box ) ) {

				const { min, max } = box;
				for ( let x = - 1; x <= 1; x += 2 ) {

					for ( let y = - 1; y <= 1; y += 2 ) {

						for ( let z = - 1; z <= 1; z += 2 ) {

							point.set(
								x < 0 ? min.x : max.x,
								y < 0 ? min.y : max.y,
								z < 0 ? min.z : max.z,
							);

							if ( ! frustum.containsPoint( point ) ) {

								return INTERSECTED;

							}

						}

					}

				}

				return CONTAINED;

			}

		},
		intersectsObject: ( object, instanceId ) => {

			object.setVisibleAt( instanceId, true );

		},
	} );

}

function createSpheres() {

	// Clear existing content
	while ( container.children.length ) {

		const child = container.children[ 0 ];
		child.material.dispose();
		child.geometry.dispose();

		if ( child.dispose ) {

			child.dispose();

		}

		container.remove( child );

	}

	const count = 500000;
	const geometries = [
		new THREE.TorusGeometry( 0.25, 0.1, 30, 30 ),
		new THREE.SphereGeometry( 0.25, 30, 30 ),
		new THREE.ConeGeometry( 0.25, 0.25 ),
		mergeVertices( new RoundedBoxGeometry( 0.25, 0.25, 0.5, 4, 1 ) ),
	];

	const colors = [
		new THREE.Color( 0xE91E63 ),
		new THREE.Color( 0x03A9F4 ),
		new THREE.Color( 0x4CAF50 ),
		new THREE.Color( 0xFFC107 ),
		new THREE.Color( 0x9C27B0 ),
	];

	// Helper to generate random transform
	const _position = new THREE.Vector3();
	const _rotation = new THREE.Euler();
	const _quaternion = new THREE.Quaternion();
	const _scale = new THREE.Vector3();
	const _matrix = new THREE.Matrix4();

	// Create BatchedMesh
	const maxVertexCount = geometries.reduce( ( sum, g ) => sum + g.attributes.position.count, 0 );
	const maxIndexCount = geometries.reduce( ( sum, g ) => sum + ( g.index ? g.index.count : 0 ), 0 );
	const material = new THREE.MeshStandardMaterial( { color: 0xFFFFFF, roughness: 0.5 } );

	batchedMesh = new THREE.BatchedMesh( count, maxVertexCount, maxIndexCount, material );
	const geometryIds = geometries.map( g => batchedMesh.addGeometry( g ) );

	for ( let i = 0; i < count; i ++ ) {

		const geometryId = geometryIds[ i % geometries.length ];
		const instanceId = batchedMesh.addInstance( geometryId );
		const colorIndex = i % colors.length;

		getRandomTransform( _matrix );
		batchedMesh.setMatrixAt( instanceId, _matrix );
		batchedMesh.setColorAt( instanceId, colors[ colorIndex ] );
		batchedMesh.setVisibleAt( instanceId, false );

	}

	container.add( batchedMesh );

	// Create new BVH
	sceneBVH = new StaticSceneBVH( container );

	bvhHelper = new MeshBVHHelper( container, sceneBVH, params.bvh.depth );
	bvhHelper.color.set( 0xffffff );
	bvhHelper.opacity = 0.5;
	bvhHelper.displayParents = params.bvh.displayParents;
	bvhHelper.update();
	scene.add( bvhHelper );

	function getRandomTransform( matrix ) {

		const d = Math.cbrt( Math.random() );
		_position.randomDirection().multiplyScalar( 300 * d );
		_rotation.set(
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI,
			Math.random() * 2 * Math.PI
		);
		_quaternion.setFromEuler( _rotation );
		_scale.setScalar( 1 + 3 * Math.random() );
		matrix.compose( _position, _quaternion, _scale );

	}

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function render() {

	stats.begin();

	controls.update();

	if ( bvhHelper ) {

		bvhHelper.depth = params.bvh.depth;
		bvhHelper.displayParents = params.bvh.displayParents;
		bvhHelper.visible = params.bvh.visualize;

	}

	if ( params.animate ) {

		container.rotation.y += ( performance.now() - lastTime ) * 1e-4 * 0.5;

	}

	lastTime = performance.now();

	const start = performance.now();
	updateVisible();
	renderer.render( scene, camera );
	const delta = performance.now() - start;

	infoElement.innerText =
		`render time: ${ delta.toFixed( 2 ) }ms\n` +
		`visible: ${ batchedMesh._multiDrawCount }`;

	stats.end();

}

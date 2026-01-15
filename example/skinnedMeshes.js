import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { StaticSceneBVH } from '..';
import { BVHHelper } from 'three-mesh-bvh';

const bgColor = 0x131619;
const params = {
	animate: false,
	bvh: {
		visualize: true,
		depth: 10,
		precise: false,
		displayParents: false,
	},
};

const characterCount = 50;

let renderer, scene, camera, controls, stats;
let container;
let characterMixers = [];
let clock;
let characterModel, danceAnimation;
let sceneBVH, bvhHelper;

init();

function init() {

	// Renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// Scene setup
	scene = new THREE.Scene();

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light.position.set( 1, 2, 1 );
	const revLight = new THREE.DirectionalLight( 0xffffff, 0.75 );
	revLight.position.set( 1, 2, 1 ).multiplyScalar( - 1 );
	scene.add( light, revLight );
	scene.add( new THREE.AmbientLight( 0xffffff, .75 ) );

	// Camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 2000 );
	camera.position.set( 9, 9, 0 );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Container for all characters
	container = new THREE.Group();
	scene.add( container );

	// Clock for animations
	clock = new THREE.Clock();

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new GUI();
	gui.add( params, 'animate' ).onChange( v => {

		if ( ! v ) {

			updateBVH();

		}

	} );

	const bvhFolder = gui.addFolder( 'Scene BVH' );
	bvhFolder.add( params.bvh, 'visualize' );
	bvhFolder.add( params.bvh, 'precise' ).onChange( () => {

		if ( ! params.animate ) {

			updateBVH();

		}

	} );
	bvhFolder.add( params.bvh, 'displayParents' ).onChange( v => {

		bvhHelper.displayParents = v;
		bvhHelper.update();

	} );
	bvhFolder.add( params.bvh, 'depth', 1, 20, 1 ).onChange( v => {

		bvhHelper.depth = v;
		bvhHelper.update();

	} );
	bvhFolder.open();

	// Event listeners
	window.addEventListener( 'resize', onWindowResize );

	// Load the character model
	loadModel();

}

function loadModel() {

	const url = 'https://raw.githack.com/mrdoob/three.js/r94/examples/models/fbx/Samba%20Dancing.fbx';
	new FBXLoader().load( url, fbx => {

		characterModel = fbx;
		danceAnimation = fbx.animations[ 0 ];

		initCharacters();

	} );

}

function initCharacters() {

	// Arrange characters using Vogel's method (sunflower seed distribution)
	const goldenAngle = Math.PI * ( 3 - Math.sqrt( 5 ) );
	const radius = 1;

	for ( let i = 0; i < characterCount; i ++ ) {

		// Clone the character (using SkeletonUtils to properly clone the skeleton)
		const character = SkeletonUtils.clone( characterModel );

		// Scale the character down (FBX models are often large)
		character.scale.setScalar( 0.01 );

		// Calculate Vogel distribution position
		const angle = i * goldenAngle;
		const dist = radius * Math.sqrt( i );

		character
			.position
			.set( Math.cos( angle ) * dist, 0, Math.sin( angle ) * dist );

		// Random rotation
		character.rotation.y = Math.random() * Math.PI * 2;
		container.add( character );

		// Setup animation mixer with dance animation
		const mixer = new THREE.AnimationMixer( character );
		characterMixers.push( mixer );

		// Init the animation to move at different speeds, start at random spots
		const action = mixer.clipAction( danceAnimation );
		action.timeScale = 0.8 + Math.random() * 0.4;
		action.time = Math.random() * danceAnimation.duration;
		action.play();

		// Update mixer once to apply the random pose
		mixer.update( 0 );

	}

	container.updateMatrixWorld( true );

	sceneBVH = new StaticSceneBVH( container, {
		maxLeafSize: 1,
		precise: params.bvh.precise,
	} );

	bvhHelper = new BVHHelper( container, sceneBVH, params.bvh.depth );
	bvhHelper.color.set( 0xffffff );
	bvhHelper.displayParents = params.bvh.displayParents;
	bvhHelper.update();
	scene.add( bvhHelper );

}

function updateBVH() {

	container.updateMatrixWorld( true );

	container.traverse( child => {

		if ( child.isSkinnedMesh ) {

			child.boundingBox = null;
			child.geometry.boundingBox = null;
			child.geometry.boundingSphere = null;

		}

	} );

	console.time( 'Refitting Scene BVH' );
	container.updateMatrixWorld( true );
	sceneBVH.precise = params.bvh.precise;
	sceneBVH.refit();
	console.timeEnd( 'Refitting Scene BVH' );

	bvhHelper.bvh = sceneBVH;
	bvhHelper.update();


}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function render() {

	requestAnimationFrame( render );

	stats.begin();
	controls.update();

	const delta = clock.getDelta();
	if ( params.animate ) {

		characterMixers.forEach( mixer => mixer.update( delta ) );

	}

	if ( bvhHelper ) {

		bvhHelper.visible = params.bvh.visualize;

	}

	renderer.render( scene, camera );
	stats.end();

}

render();

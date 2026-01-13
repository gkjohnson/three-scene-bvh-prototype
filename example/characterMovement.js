import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH, BVHHelper } from 'three-mesh-bvh';
import { StaticSceneBVH } from '..';

const params = {

	firstPerson: false,
	displayBVH: false,
	visualizeDepth: 10,
	gravity: - 80,
	playerSpeed: 10,
	physicsSteps: 5,

	reset: reset,

};

const OFF_GROUND_TIME = 0.05;
let offGroundTimer = OFF_GROUND_TIME;
let renderer, camera, scene, clock, gui, stats;
let level, player, playerMesh, controls, sceneBVH, sceneHelper;
let playerIsOnGround = false;
let fwdPressed = false, bkdPressed = false, lftPressed = false, rgtPressed = false;
let playerVelocity = new THREE.Vector3();
let upVector = new THREE.Vector3( 0, 1, 0 );
let tempVector = new THREE.Vector3();
let tempVector2 = new THREE.Vector3();
let sceneLocalBox = new THREE.Box3();
let objectLocalBox = new THREE.Box3();
let invMat = new THREE.Matrix4();
let worldSegment = new THREE.Line3();
let localSegment = new THREE.Line3();
let sphere = new THREE.Sphere();

init();
render();

function init() {

	const bgColor = 0x263238 / 2;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	// scene.fog = new THREE.Fog( bgColor, 20, 70 );

	// lights
	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 1, 1.5, 1 ).multiplyScalar( 50 );
	light.shadow.mapSize.setScalar( 2048 );
	light.shadow.bias = - 1e-4;
	light.shadow.normalBias = 0.05;
	light.shadow.radius = 5;
	light.castShadow = true;

	const shadowCam = light.shadow.camera;
	shadowCam.bottom = shadowCam.left = - 30;
	shadowCam.top = 30;
	shadowCam.right = 45;

	scene.add( light );
	scene.add( new THREE.HemisphereLight( 0xffffff, 0x223344, 0.4 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 10, 10, - 10 );
	camera.far = 100;
	camera.updateProjectionMatrix();
	window.camera = camera;

	clock = new THREE.Clock();

	controls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	loadColliderEnvironment();

	// character
	player = new THREE.Group();
	player.rotation.y = Math.PI / 2;
	player.capsuleInfo = {
		radius: 0.75,
		segment: new THREE.Line3( new THREE.Vector3( 0, 0.75, 0 ), new THREE.Vector3( 0, 1.0, 0.0 ) )
	};

	playerMesh = new THREE.Group();
	player.add( playerMesh );

	const body = new THREE.Mesh(
		new RoundedBoxGeometry( 1.0, 2.0, 1.0, 10, 0.5 ),
		new THREE.MeshStandardMaterial()
	);
	body.position.y = 0.75;
	body.castShadow = true;
	body.receiveShadow = true;
	body.material.shadowSide = 2;

	const arms = new THREE.Mesh(
		new RoundedBoxGeometry( 0.5, 2.0, 0.5, 10, 0.5 ),
		new THREE.MeshStandardMaterial()
	);
	arms.rotation.x = Math.PI / 2;
	arms.position.y = 1.25;
	arms.castShadow = true;
	arms.receiveShadow = true;
	arms.material.shadowSide = 2;

	const head = new THREE.Mesh(
		new THREE.SphereGeometry(),
		new THREE.MeshStandardMaterial()
	);
	head.scale.setScalar( 0.5 );
	head.position.y = 1 + 1;
	head.castShadow = true;
	head.receiveShadow = true;
	head.material.shadowSide = 2;

	playerMesh.add( body, arms, head );


	scene.add( player );
	reset();

	// dat.gui
	gui = new GUI();
	gui.add( params, 'firstPerson' ).onChange( v => {

		if ( ! v ) {

			camera
				.position
				.sub( controls.target )
				.normalize()
				.multiplyScalar( 10 )
				.add( controls.target );

		}

	} );

	const visFolder = gui.addFolder( 'Visualization' );
	visFolder.add( params, 'displayBVH' );
	visFolder.add( params, 'visualizeDepth', 1, 20, 1 ).onChange( v => {

		sceneHelper.depth = v;
		sceneHelper.update();

	} );
	visFolder.open();

	const physicsFolder = gui.addFolder( 'Player' );
	physicsFolder.add( params, 'physicsSteps', 0, 30, 1 );
	physicsFolder.add( params, 'gravity', - 100, 100, 0.01 ).onChange( v => {

		params.gravity = parseFloat( v );

	} );
	physicsFolder.add( params, 'playerSpeed', 1, 20 );
	physicsFolder.open();

	gui.add( params, 'reset' );
	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'keydown', function ( e ) {

		switch ( e.code ) {

			case 'KeyW': fwdPressed = true; break;
			case 'KeyS': bkdPressed = true; break;
			case 'KeyD': rgtPressed = true; break;
			case 'KeyA': lftPressed = true; break;
			case 'Space':
				if ( playerIsOnGround || offGroundTimer > 0 ) {

					playerVelocity.y = 20.0;
					playerIsOnGround = false;
					offGroundTimer = 0;

				}

				break;

		}

	} );

	window.addEventListener( 'keyup', function ( e ) {

		switch ( e.code ) {

			case 'KeyW': fwdPressed = false; break;
			case 'KeyS': bkdPressed = false; break;
			case 'KeyD': rgtPressed = false; break;
			case 'KeyA': lftPressed = false; break;

		}

	} );

}

function loadColliderEnvironment() {

	new GLTFLoader()
		.load( new URL( './models/grandmas_house_compressed.glb', import.meta.url ).toString(), res => {

			const gltfScene = res.scene;
			gltfScene.scale.setScalar( 1.75 );

			const box = new THREE.Box3();
			box.setFromObject( gltfScene );
			gltfScene.updateMatrixWorld( true );

			// visual geometry setup
			let toRemove = [];
			gltfScene.traverse( c => {

				if ( /cat/.test( c.name ) || /sheep/.test( c.name ) ) {

					c.traverse( c => {

						if ( c.material ) {

							c.material = c.material.clone();
							c.material.color.set( 0xff0000 );

						}

					} );
					toRemove.push( c );
					return;

				}

				c.castShadow = true;
				c.receiveShadow = true;
				if ( c.isMesh && ! c.geometry.boundsTree ) {

					c.geometry.boundsTree = new MeshBVH( c.geometry );

				}

			} );

			toRemove.forEach( c => c.removeFromParent() );

			level = gltfScene;
			scene.add( level );

			level.updateMatrixWorld( true );
			sceneBVH = new StaticSceneBVH( level, { maxLeafSize: 1 } );
			sceneHelper = new BVHHelper( level, sceneBVH );
			sceneHelper.update();
			sceneHelper.opacity = 0.75;
			sceneHelper.color.set( 0xffffff );
			scene.add( sceneHelper );

		} );

}

function reset() {

	playerVelocity.set( 0, 0, 0 );
	player.position.set( 8, 10, 2.5 );
	camera.position.sub( controls.target );
	controls.target.copy( player.position );
	camera.position.add( player.position );
	controls.update();

}

function updatePlayer( delta ) {

	// adjust player position based on collisions
	player.updateMatrixWorld();
	invMat.copy( sceneBVH.matrixWorld ).invert();

	// get the position of the capsule in world space
	const capsuleInfo = player.capsuleInfo;
	worldSegment.copy( capsuleInfo.segment );
	worldSegment.applyMatrix4( player.matrixWorld );

	// apply gravity and move the player
	worldSegment.start.addScaledVector( playerVelocity, delta );
	worldSegment.end.addScaledVector( playerVelocity, delta );

	// move the player
	const angle = controls.getAzimuthalAngle();
	const walkDirection = new THREE.Vector3();
	if ( fwdPressed ) {

		tempVector.set( 0, 0, - 1 ).applyAxisAngle( upVector, angle );
		walkDirection.addScaledVector( tempVector, params.playerSpeed * delta );

	}

	if ( bkdPressed ) {

		tempVector.set( 0, 0, 1 ).applyAxisAngle( upVector, angle );
		walkDirection.addScaledVector( tempVector, params.playerSpeed * delta );

	}

	if ( lftPressed ) {

		tempVector.set( - 1, 0, 0 ).applyAxisAngle( upVector, angle );
		walkDirection.addScaledVector( tempVector, params.playerSpeed * delta );

	}

	if ( rgtPressed ) {

		tempVector.set( 1, 0, 0 ).applyAxisAngle( upVector, angle );
		walkDirection.addScaledVector( tempVector, params.playerSpeed * delta );

	}

	// apply walk direction to the collider
	if ( walkDirection.length() > 0 ) {

		worldSegment.start.add( walkDirection );
		worldSegment.end.add( walkDirection );

		const right = new THREE.Vector3( 1, 0, 0 );
		const walkAngle = right.angleTo( walkDirection.normalize() );
		right.cross( walkDirection );

		const sign = Math.sign( right.y );
		const quat = new THREE.Quaternion().setFromAxisAngle( right.set( 0, 1, 0 ), sign * walkAngle );
		player.quaternion.slerp( quat, 1 - ( 2 ** ( - delta / 0.05 ) ) );

		const t = window.performance.now() * 0.025;
		playerMesh.position.y = Math.abs( Math.sin( t ) ) * 0.5;
		playerMesh.rotation.x = Math.sin( t ) * 0.25;

		if ( offGroundTimer < 0 ) {

			playerMesh.position.y = 0;
			playerMesh.rotation.x = 0;

		}

	} else {

		playerMesh.position.y = 0;
		playerMesh.rotation.x = 0;

	}

	playerVelocity.y += delta * params.gravity;

	// get the axis aligned bounding box of the capsule in local scene bvh space
	sceneLocalBox.makeEmpty();
	sceneLocalBox.expandByPoint( worldSegment.start );
	sceneLocalBox.expandByPoint( worldSegment.end );

	sceneLocalBox.min.addScalar( - capsuleInfo.radius );
	sceneLocalBox.max.addScalar( capsuleInfo.radius );
	sceneLocalBox.applyMatrix4( invMat );

	const segmentStart = worldSegment.start.clone();
	sceneBVH.shapecast( {

		intersectsBounds: box => box.intersectsBox( sceneLocalBox ),

		intersectsObject: object => {

			if ( ! object.visible || object.material.transparent ) {

				return;

			}

			invMat.copy( object.matrixWorld ).invert();

			// get the axis aligned bounding box of the capsule in local object space
			objectLocalBox.makeEmpty();
			objectLocalBox.expandByPoint( worldSegment.start );
			objectLocalBox.expandByPoint( worldSegment.end );

			objectLocalBox.min.addScalar( - capsuleInfo.radius );
			objectLocalBox.max.addScalar( capsuleInfo.radius );
			objectLocalBox.applyMatrix4( invMat );

			// get the segment in the local space for triangle intersection
			localSegment.copy( worldSegment ).applyMatrix4( invMat );
			sphere.radius = capsuleInfo.radius;

			// calculate the radius of the capsule in the local space
			sphere.applyMatrix4( invMat );

			const localRadius = sphere.radius;
			object.geometry.boundsTree.shapecast( {

				intersectsBounds: box => box.intersectsBox( objectLocalBox ),

				intersectsTriangle: tri => {

					// check if the triangle is intersecting the capsule and adjust the
					// capsule position if it is.
					const triPoint = tempVector;
					const capsulePoint = tempVector2;

					const distance = tri.closestPointToSegment( localSegment, triPoint, capsulePoint );
					if ( distance < localRadius ) {

						const depth = localRadius - distance;
						const direction = capsulePoint.sub( triPoint ).normalize();

						localSegment.start.addScaledVector( direction, depth );
						localSegment.end.addScaledVector( direction, depth );

					}

				}

			} );

			worldSegment.copy( localSegment ).applyMatrix4( object.matrixWorld );

		},

	} );

	// shift the player
	const deltaVector = tempVector2;
	deltaVector.copy( player.capsuleInfo.segment.start ).applyMatrix4( player.matrixWorld );
	deltaVector.subVectors( worldSegment.start, deltaVector );

	player.position.add( deltaVector );

	// check how much the geometry "pushed" the capsule
	deltaVector.copy( segmentStart );
	deltaVector.subVectors( worldSegment.start, deltaVector );

	// if the player was primarily adjusted vertically we assume it's on something we should consider ground
	const touchingGround = deltaVector.y > Math.abs( delta * playerVelocity.y * 0.25 );
	if ( touchingGround ) {

		offGroundTimer = OFF_GROUND_TIME;
		playerIsOnGround = true;

	} else {

		offGroundTimer -= delta;
		playerIsOnGround = false;

	}

	if ( ! touchingGround ) {

		playerVelocity.addScaledVector( deltaVector, - deltaVector.dot( playerVelocity ) );

	} else {

		playerVelocity.set( 0, 0, 0 );

	}

	// if the player has fallen too far below the level reset their position to the start
	if ( player.position.y < - 5 ) {

		reset();

	}

}

function updateCamera() {

	// adjust the camera
	camera.position.sub( controls.target );
	controls.target.sub( player.position );

	const scalar = camera.position.length() * 0.1;
	let heightOffset = controls.target.y;
	controls.target.y = 0;
	if ( controls.target.length() > 4 * scalar ) {

		controls.target.normalize();
		controls.target.multiplyScalar( 4 * scalar );

	}

	if ( heightOffset < 1.5 - 0.5 * scalar ) {

		heightOffset = 1.5 - 0.5 * scalar;

	} else if ( heightOffset > 1.5 + 1 * scalar ) {

		heightOffset = 1.5 + 1 * scalar;

	}

	controls.target.y = heightOffset;
	controls.target.add( player.position );
	camera.position.add( controls.target );

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	const delta = Math.min( clock.getDelta(), 0.1 );
	if ( params.firstPerson ) {

		controls.maxPolarAngle = Math.PI;
		controls.minDistance = 1e-4;
		controls.maxDistance = 1e-4;

	} else {

		controls.maxPolarAngle = Math.PI / 2;
		controls.minDistance = 1;
		controls.maxDistance = 20000;

	}

	if ( level ) {

		sceneHelper.visible = params.displayBVH;

		const physicsSteps = params.physicsSteps;
		for ( let i = 0; i < physicsSteps; i ++ ) {

			updatePlayer( delta / physicsSteps );

		}

	}

	updateCamera();

	// TODO: limit the camera movement based on the collider
	// raycast in direction of camera and move it if it's further than the closest point

	controls.update();

	renderer.render( scene, camera );

}

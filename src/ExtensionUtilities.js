import { StaticSceneBVH } from './StaticSceneBVH.js';

export function computeSceneBoundsTree( options ) {

	this.sceneBoundsTree = new StaticSceneBVH( this, options );

}

export function disposeSceneBoundsTree() {

	this.sceneBoundsTree = null;

}

export function acceleratedSceneRaycast( raycaster, intersects ) {

	if ( this.sceneBoundsTree ) {

		this.sceneBoundsTree.raycast( raycaster, intersects );
		return false;

	}

}

# three-scene-bvh-prototype

A prototype for a generalized Scene BVH implementation to enable efficient spatial queries and raycasting across multiple objects in a scene using three-mesh-bvh. The class includes support for three.js renderable objects, including treating individual InstancedMesh & BatchedMesh instances as separate nodes during queries.

**TODO**
- Adjust or add a new SceneBVHHelper that can include the BVHs of children, as well, by checking "boundsTree".
- Add support for SkinnedMeshes / MorphTarget meshes (just use "getVertex" for this case?)
- Gaussian splat proof of concept

# Use

Use the StaticSceneBVH instance directly:

```js
import { StaticSceneBVH } from 'three-scene-bvh-prototype';

// ...

// Set up a group with any number of children for rendering.
// Once children are added they cannot change or move.
const group = new Group();
group.add( /* ... */ );
scene.add( group );

const staticBVH = new StaticSceneBVH( group, {
	precise: true,
	includeInstances: true,
} );

// Run a custom spatial query
staticBVH.shapecast( { /* ... */ } );

// Or run a raycast query
const intersects = staticBVH.raycast( raycaster );
```

Or use convenience functions for construction & raycasting:

```js
import {
	computeSceneBVH,
	disposeSceneBVH,
	acceleratedSceneRaycast,
} from 'three-scene-bvh-prototype';

// Add new BVH construction functions
THREE.Object3D.prototype.computeSceneBVH = computeSceneBVH;
THREE.Object3D.prototype.disposeSceneBVH = disposeSceneBVH;

// ...

// Override the raycast function with one that will use BVH if available
group.raycast = acceleratedSceneRaycast;
group.computeSceneBVH( {
	precise: true,
	includeInstances: true,
} );

// BVH is available on "sceneBoundsTree"
group.sceneBoundsTree.shapecast( { /* ... */ } );
```

# API

## StaticSceneBVH

A class used for building a BVH of scene or series of objects that are static and unchanging. Adding, removing, or moving objects will require constructing a new BVH.

### constructor

```js
constructor( root: Array<Object3D>|Object3D, options: BVHOptions )
```

Take a single "root" object or series of roots from which to derive all leaf nodes for BVH construction. "Options" match the three-mesh-bvh options with the following additions:

```js
{
	// The frame to construct the BVH relative to. If "root" is a single object then this
	// is automatically set to that objects matrixWorld.
	matrixWorld: Matrix4,

	// If "true" then bounds are calculated to be perfectly tight around the vertices by
	// transforming each vertex into the BVH frame during construction. Otherwise the geometry
	// bounding box is transformed resulting in a more loose BVH.
	precise: false,

	// If "true" then individual instances from BatchedMesh & InstancedMesh will be included
	// in the BVH construction. Otherwise BatchedMesh & InstancedMesh will be treated as whole objects.
	includeInstances: true,
}
```

### shapecast

```js
shapecast( callbacks: ShapecastCallbacks & {
	intersectsObject( object: Object3D, instanceId: number ): boolean,
} ): boolean
```

Takes the same callbacks as provided in MeshBVH with the addition of an `intersectsObject` callback with an "object" and "instanceId" argument.

### raycast

```js
raycast( raycaster: Raycaster, intersects: Array<Hit> ): Array<Hit>
```

Performs a BVH-accelerated raycast query. Respects `raycaster.firstHitOnly` flag to further accelerate queries.

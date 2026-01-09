import { Box3, BufferGeometry, Matrix4, Mesh, Vector3, Ray } from 'three';
import { BVH, INTERSECTED, NOT_INTERSECTED, FLOAT32_EPSILON } from 'three-mesh-bvh';

const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _vec = /* @__PURE__ */ new Vector3();
const _center = /* @__PURE__ */ new Vector3();
const _size = /* @__PURE__ */ new Vector3();
const _ray = /* @__PURE__ */ new Ray();
const _mesh = /* @__PURE__ */ new Mesh();
const _geometryRange = {};

// TODO: how can we use this for frustum culling?
// TODO: account for a "custom" object? Not necessary here? Create a more abstract foundation for this case?
// TODO: can we handle margin? Custom expansion?
// TODO: add comments
export class StaticSceneBVH extends BVH {

	constructor( root, options = {} ) {

		options = {
			precise: false,
			includeInstances: true,
			matrix: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			maxLeafSize: 1,
			...options,
		};

		super();

		const objectSet = new Set();
		collectObjects( root, objectSet );

		const objects = Array.from( objectSet );
		const idBits = Math.ceil( Math.log2( objects.length ) );
		const idMask = constructIdMask( idBits );

		this.objects = objects;
		this.idBits = idBits;
		this.idMask = idMask;
		this.primitiveBuffer = null;
		this.primitiveBufferStride = 1;

		// settings
		this.precise = options.precise;
		this.includeInstances = options.includeInstances;
		this.matrixWorld = options.matrixWorld;

		this.init( options );

	}

	init( options ) {

		const { objects, idBits } = this;
		this.primitiveBuffer = new Uint32Array( this._countPrimitives( objects ) );
		this._fillPrimitiveBuffer( objects, idBits, this.primitiveBuffer );

		super.init( options );

	}

	computePrimitiveBounds( offset, count, targetBuffer ) {

		const { primitiveBuffer } = this;
		const boundsOffset = targetBuffer.offset || 0;

		_inverseMatrix.copy( this.matrixWorld ).invert();
		for ( let i = offset; i < count; i ++ ) {

			this._getPrimitiveBoundingBox( primitiveBuffer[ i ], _inverseMatrix, _box );

			_box.getCenter( _center );
			_box.getSize( _size );

			const { x, y, z } = _center;
			const hx = _size.x / 2;
			const hy = _size.y / 2;
			const hz = _size.z / 2;

			const baseIndex = ( i - boundsOffset ) * 6;
			targetBuffer[ baseIndex + 0 ] = x;
			targetBuffer[ baseIndex + 1 ] = hx + Math.abs( x ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 2 ] = y;
			targetBuffer[ baseIndex + 3 ] = hy + Math.abs( y ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 4 ] = z;
			targetBuffer[ baseIndex + 5 ] = hz + Math.abs( z ) * FLOAT32_EPSILON;

		}

		return targetBuffer;

	}

	getRootRanges() {

		return [ {
			offset: 0,
			count: this.objects.length,
		} ];

	}

	shapecast( callbacks ) {

		return super.shapecast( {
			...callbacks,

			intersectsPrimitive: callbacks.intersectsObject,
			scratchPrimitive: null,
			iterate: iterateOverObjects,
		} );

	}

	raycast( raycaster, intersects = [] ) {

		const { matrixWorld, includeInstances } = this;
		const { firstHitOnly } = raycaster;
		const localIntersects = [];

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		let closestDistance = Infinity;
		let closestHit = null;

		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				if ( firstHitOnly ) {

					if ( ! _ray.intersectBox( box, _vec ) ) {

						return NOT_INTERSECTED;

					}

					_vec.applyMatrix4( matrixWorld );

					return raycaster.ray.distanceTo( _vec ) < closestDistance ? INTERSECTED : NOT_INTERSECTED;

				} else {

					return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

				}

			},
			intersectsObject( object, instanceId ) {

				if ( ! object.visible ) {

					return;

				}

				if ( object.isInstancedMesh && includeInstances ) {

					_mesh.geometry = object.geometry;
					_mesh.material = object.material;

					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					localIntersects.forEach( hit => {

						hit.object = object;
						hit.instanceId = instanceId;

					} );

					_mesh.material = null;

				} else if ( object.isBatchedMesh && includeInstances ) {

					if ( ! object.getVisibleAt( instanceId ) ) {

						return;

					}

					const geometryId = object.getGeometryIdAt( instanceId );
					const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

					_geometry.index = object.geometry.index;
					_geometry.attributes.position = object.geometry.attributes.position;
					_geometry.setDrawRange( geometryRange.start, geometryRange.count );

					_mesh.geometry = _geometry;
					_mesh.material = object.material;

					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.matrixWorld.premultiply( object.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					localIntersects.forEach( hit => {

						hit.object = object;
						hit.batchId = instanceId;

					} );

					_mesh.material = null;

				} else {

					object.raycast( raycaster, localIntersects );

				}

				if ( firstHitOnly ) {

					localIntersects.forEach( hit => {

						if ( hit.distance < closestDistance ) {

							closestDistance = hit.distance;
							closestHit = hit;

						}

					} );

				} else {

					intersects.push( ...localIntersects );

				}

			},
		} );

		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

	_getPrimitiveBoundingBox( compositeId, inverseMatrixWorld, target ) {

		const { objects, idMask, idBits, precise, includeInstances } = this;
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = objects[ id ];

		if ( ! includeInstances && ( object.isInstancedMesh || object.isBatchedMesh ) ) {

			if ( ! object.boundingBox ) {

				object.computeBoundingBox();

			}

			_matrix
				.copy( object.matrixWorld )
				.premultiply( _inverseMatrix );

			_box
				.copy( object.boundingBox )
				.applyMatrix4( _matrix );

		} else if ( precise ) {

			if ( object.isInstancedMesh ) {

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( object.geometry, _matrix, _box );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );
				const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

				_geometry.index = object.geometry.index;
				_geometry.attributes.position = object.geometry.attributes.position;
				_geometry.setDrawRange( geometryRange.start, geometryRange.count );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( _geometry, _matrix, _box );

			} else {

				_matrix
					.copy( object.matrixWorld )
					.premultiply( _inverseMatrix );

				getPreciseBounds( object.geometry, _matrix, _box );

			}

		} else {

			if ( object.isInstancedMesh ) {

				if ( ! object.geometry.boundingBox ) {

					object.geometry.computeBoundingBox();

				}

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				target
					.copy( object.geometry.boundingBox )
					.applyMatrix4( _matrix );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				object
					.getBoundingBoxAt( geometryId, target )
					.applyMatrix4( _matrix );

			} else {

				if ( ! object.geometry.boundingBox ) {

					object.geometry.computeBoundingBox();

				}

				target
					.copy( object.geometry.boundingBox )
					.applyMatrix4( object.matrixWorld )
					.applyMatrix4( inverseMatrixWorld );

			}

		}

	}

	_countPrimitives( array ) {

		const { includeInstances } = this;
		let total = 0;
		array.forEach( object => {

			if ( object.isInstancedMesh && includeInstances ) {

				total += object.count;

			} else if ( object.isBatchedMesh && includeInstances ) {

				total += object.instanceCount;

			} else {

				total ++;

			}

		} );

		return total;

	}

	_fillPrimitiveBuffer( objects, idBits, target ) {

		const { includeInstances } = this;
		let index = 0;
		objects.forEach( ( object, i ) => {

			if ( object.isInstancedMesh && includeInstances ) {

				const count = object.count;
				for ( let c = 0; c < count; c ++ ) {

					target[ index ] = ( c << idBits ) | i;
					index ++;

				}

			} else if ( object.isBatchedMesh && includeInstances ) {

				const count = object.instanceCount;
				let instance = 0;
				let iter = 0;
				while ( instance < count && iter < 1e6 ) {

					iter ++;

					try {

						object.getVisibleAt( instance );

						target[ index ] = ( instance << idBits ) | i;
						instance ++;
						index ++;

					} catch {

						//

					}

				}

			} else {

				target[ index ] = i;
				index ++;

			}

		} );

	}

}

function constructIdMask( idBits ) {

	let mask = 0;
	for ( let i = 0; i < idBits; i ++ ) {

		mask = mask << 1 | 1;

	}

	return mask;

}

function getObjectId( id, idMask ) {

	return id & idMask;

}

function getInstanceId( id, idBits, idMask ) {

	return ( id & ( ~ idMask ) ) >> idBits;

}

function collectObjects( root, objectSet = new Set() ) {

	if ( Array.isArray( root ) ) {

		root.forEach( object => collectObjects( object, objectSet ) );

	} else {

		root.traverse( child => {

			if ( child.isMesh || child.isLine || child.isPoints ) {

				objectSet.add( child );

			}

		} );

	}

}

function getPreciseBounds( geometry, matrix, target ) {

	target.empty();

	const drawRange = geometry.drawRange;
	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const offset = drawRange.offset;
	const count = Math.min( indexAttr.count - offset, drawRange.count );
	for ( let i = offset, l = offset + count; i < l; i ++ ) {

		let vi = i;
		if ( indexAttr ) {

			vi = indexAttr.getX( vi );

		}

		_vec.fromBufferAttribute( posAttr, vi ).applyMatrix4( matrix );
		target.expandByPoint( _vec );

	}

	return target;

}

function iterateOverObjects( offset, count, bvh, callback, contained, depth, /* scratch */ ) {

	const { primitiveBuffer, objects, idMask, idBits } = bvh;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const compositeId = primitiveBuffer[ i ];
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = objects[ id ];
		if ( callback( object, instanceId, contained, depth ) ) {

			return true;

		}

	}

	return false;

}

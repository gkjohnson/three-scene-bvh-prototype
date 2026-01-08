import { Box3, BufferGeometry, Matrix4, Vector3 } from 'three';
import { BVH } from 'three-mesh-bvh';

const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _vec = /* @__PURE__ */ new Vector3();
const _center = /* @__PURE__ */ new Vector3();
const _size = /* @__PURE__ */ new Vector3();
const _geometryRange = {};

// TODO: how can we use this for frustum culling?
// TODO: account for a "custom" object? Not necessary here? Create a more abstract foundation for this case?
export class StaticSceneBVH extends BVH {

    constructor( root, options = {} ) {

        options = {
            precise: false,
            includeInstances: true,
            matrix: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
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

        return this.shapecast( {
            ...callbacks,

            // TODO: handle these
            intersectsPrimitive: callbacks.intersectsPoint,
            scratchPrimitive: point,
            iterate: iterateOverPoints,
        } );

    }

    raycast( raycaster, intersects ) {

        // TODO: support "firstHitOnly"

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
                    .copy( object.geometry.boundingSphere )
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

                    target[ index ] = c << idBits & i;
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

                        target[ index ] = instance << idBits & i;
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
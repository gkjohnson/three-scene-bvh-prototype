import { Matrix4, Sphere } from 'three';
import { BVH } from 'three-mesh-bvh';

const sphere = /* @__PURE__ */ new Sphere();
const matrix = /* @__PURE__ */ new Matrix4();

// TODO: how can we use this for frustum culling?
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
        const primitiveBuffer = new Uint32Array( countPrimitives( objects ) );
        fillPrimitiveBuffer( objects, idBits, primitiveBuffer );

        this.objects = objects;
        this.idBits = idBits;
        this.idMask = idMask;
        this.primitiveBuffer = primitiveBuffer;
        this.primitiveBufferStride = 1;
        
        // TODO: account for this in bounds construction
        this.precise = options.precise;

        // TODO: account for this in bounds construction, id generation
        this.includeInstances = options.includeInstances;

        // TODO: account for matrix in the bounds construction
        this.matrixWorld = options.matrixWorld;

        this.init( options );

    }

    computePrimitiveBounds( offset, count, targetBuffer ) {

        const { primitiveBuffer, objects, idMask, idBits } = this;
		const boundsOffset = targetBuffer.offset || 0;
        for ( let i = offset; i < count; i ++ ) {

            const id = getObjectId( primitiveBuffer[ i ], idMask );
            const instanceId = getInstanceId( primitiveBuffer[ i ], idBits, idMask );
            const object = objects[ id ];
            if ( object.isInstancedMesh ) {

                if ( ! object.geometry.boundingSphere ) {

                    object.geometry.computeBoundingSphere();

                }

                object.getMatrixAt( instanceId, matrix );
                matrix.premultiply( object.matrixWorld );

                sphere.copy( object.geometry.boundingSphere ).applyMatrix4( matrix );

            } else if ( object.isBatchedMesh ) {

                object.getMatrixAt( instanceId, matrix );
                matrix.premultiply( object.matrixWorld );

                const geometryId = object.getGeometryIdAt( instanceId );
    			object.getBoundingSphereAt( geometryId, sphere ).applyMatrix4( matrix );

            } else {

                if ( ! object.geometry.boundingSphere ) {

                    object.geometry.computeBoundingSphere();

                }

                sphere.copy( object.geometry.boundingSphere ).applyMatrix4( object.matrixWorld );

            }

            const baseIndex = ( i - boundsOffset ) * 6;
            const { center, radius } = sphere;
            const { x, y, z } = center;
            targetBuffer[ baseIndex + 0 ] = x;
            targetBuffer[ baseIndex + 1 ] = radius + Math.abs( x ) * FLOAT32_EPSILON;
            targetBuffer[ baseIndex + 2 ] = y;
            targetBuffer[ baseIndex + 3 ] = radius + Math.abs( y ) * FLOAT32_EPSILON;
            targetBuffer[ baseIndex + 4 ] = z;
            targetBuffer[ baseIndex + 5 ] = radius + Math.abs( z ) * FLOAT32_EPSILON;

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

function fillPrimitiveBuffer( objects, idBits, target ) {

    let index = 0;
    objects.forEach( ( object, i ) => { 

        if ( object.isInstancedMesh ) {

            const count = object.count;
            for ( let c = 0; c < count; c ++ ) {

                target[ index ] = c << idBits & i;
                index ++;

            }
            
        } else if ( object.isBatchedMesh ) {

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

function countPrimitives( array ) {

    let total = 0;
    array.forEach( object => {

        if ( object.isInstancedMesh ) {

            total += object.count;

        } else if ( object.isBatchedMesh ) {

            total += object.instanceCount;

        } else {

            total ++;

        }

    } );

    return total;

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
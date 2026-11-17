import * as THREE from 'three';
import { transformGeometryPoint, validateGeometryRecipe } from './geometryRecipe';
import type { GeometryPart, WorldObject } from './types';

function primitiveGeometry(part: GeometryPart): THREE.BufferGeometry {
  switch (part.primitive) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 16, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 16, 10);
    case 'extruded-polygon': {
      const shape = new THREE.Shape(
        part.footprint!.map(([east, north]) => new THREE.Vector2(east, north)),
      );
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false,
        steps: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, -0.5, 0);
      return geometry;
    }
  }
}

/** Fixed primitive tessellation and a strict declarative transform; no recipe content is executed. */
export function addGeometryRecipe(group: THREE.Group, object: WorldObject): void {
  const recipe = object.geometry;
  const errors = validateGeometryRecipe(recipe, object);
  if (errors.length) throw new Error(`Invalid geometry for ${object.id}: ${errors[0]}`);
  if (!recipe) return;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  group.userData.rendering = {
    adapter: 'geometry-parts',
    recipeVersion: recipe.version,
    partCount: recipe.parts.length,
    evidence: 'authored',
  };
  for (const part of recipe.parts) {
    const geometry = primitiveGeometry(part),
      positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      const point = transformGeometryPoint(
        [positions.getX(index), positions.getY(index), -positions.getZ(index)],
        part,
      );
      positions.setXYZ(
        index,
        point[0] * object.width,
        point[1] * object.height,
        -point[2] * object.depth,
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    let material = materials.get(part.color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: part.color,
        roughness: 0.86,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      materials.set(part.color, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.label;
    mesh.userData = {
      renderRole: 'recipe-part',
      recipePartId: part.id,
      recipePart: structuredClone(part),
      detailEvidence: 'authored',
      detailNote:
        'Declarative authored geometry. Appearance does not verify real-world observations or source facts.',
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

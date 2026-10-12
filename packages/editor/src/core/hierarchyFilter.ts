import type { Entity, Scene } from '@rowan/core';

/**
 * The entities whose name contains the search text, in hierarchy order. The comparison
 * ignores case and surrounding spaces; a blank search matches every entity.
 */
export function filterEntitiesByName(scene: Scene, search: string): Entity[] {
  const needle = search.trim().toLowerCase();
  const entities = scene.entitiesInHierarchyOrder();
  if (needle === '') {
    return entities;
  }
  return entities.filter((entity) => entity.name.toLowerCase().includes(needle));
}

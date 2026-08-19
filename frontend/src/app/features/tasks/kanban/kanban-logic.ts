/** Reordena `ids` colocando `draggedId` imediatamente antes de `targetId`
 * (ou no fim, se `targetId` for null ou não existir na lista). */
export function reorderIds(ids: string[], draggedId: string, targetId: string | null): string[] {
  const withoutDragged = ids.filter((id) => id !== draggedId);
  if (targetId === null) return [...withoutDragged, draggedId];
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) return [...withoutDragged, draggedId];
  const result = [...withoutDragged];
  result.splice(targetIndex, 0, draggedId);
  return result;
}

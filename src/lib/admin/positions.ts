import { END_OF_LIST } from './forms';

export interface PositionOption {
  value: number;
  label: string;
  selected: boolean;
}

interface Placeable {
  id: string;
  name: string;
  status: string;
}

export function positionOptions(items: Placeable[], currentId?: string): PositionOption[] {
  const visible = items.filter((item) => item.status !== 'archived');
  const currentIndex = currentId ? visible.findIndex((item) => item.id === currentId) : -1;

  const options = visible.map((item, index) => ({
    value: index + 1,
    label: item.id === currentId ? `Posición ${index + 1}: la actual` : `Posición ${index + 1}: ahora «${item.name}»`,
    selected: index === currentIndex,
  }));

  if (currentIndex === -1) {
    options.push({ value: END_OF_LIST, label: 'Al final de la lista', selected: true });
  }
  return options;
}

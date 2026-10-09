import type { AdminItem } from '../types/database';

export const NEAR_COMPLETION_THRESHOLD = 0.75;

export interface ItemStatusCounts {
    visible: number;
    completed: number;
    hidden: number;
    archived: number;
}

export interface NearCompletionItem {
    id: string;
    name: string;
    goal: number;
    raised: number;
    percent: number;
}

export function countItemsByStatus(items: AdminItem[]): ItemStatusCounts {
    const counts: ItemStatusCounts = { visible: 0, completed: 0, hidden: 0, archived: 0 };
    for (const item of items) {
        if (item.status === 'archived') counts.archived++;
        else if (item.status === 'draft') counts.hidden++;
        else if (item.raised >= item.goal) counts.completed++;
        else counts.visible++;
    }
    return counts;
}

export function itemsNearCompletion(items: AdminItem[]): NearCompletionItem[] {
    return items
        .filter((item) => (item.status === 'active' || item.status === 'funded') && item.goal > 0 && item.raised < item.goal && item.raised / item.goal >= NEAR_COMPLETION_THRESHOLD)
        .map((item) => ({ id: item.id, name: item.name, goal: item.goal, raised: item.raised, percent: Math.floor((item.raised / item.goal) * 100) }))
        .sort((a, b) => b.percent - a.percent);
}

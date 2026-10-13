import type {
  JobNeeds,
  NormalJob,
  ReusableWorkflowCallJob,
} from '../github/types.js';

type Job = NormalJob | ReusableWorkflowCallJob;

export interface JobGroup {
  ids: string[];
}

/**
 * Normalise a job's `needs` into a list of dependency ids.
 */
export function normaliseNeeds(needs: JobNeeds | undefined): string[] {
  if (needs === undefined) {
    return [];
  }
  return Array.isArray(needs) ? needs : [needs];
}

/**
 * Group jobs transitively linked by `needs`.
 */
function findConnectedJobs(
  ids: string[],
  needs: Map<string, string[]>,
): Map<string, string> {
  const parent = new Map(ids.map((id) => [id, id]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let node = id;
    while (parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };

  for (const [id, deps] of needs) {
    for (const dep of deps) {
      parent.set(find(id), find(dep));
    }
  }

  return new Map(ids.map((id) => [id, find(id)]));
}

/**
 * Insert `id` into the already-sorted `list`, keeping it ordered by `compare`.
 */
function insertSorted(
  list: string[],
  id: string,
  compare: (a: string, b: string) => number,
): void {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] !== undefined && compare(list[mid], id) < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  list.splice(low, 0, id);
}

/**
 * Order a group's ids so each job follows every job it needs.
 */
function orderByNeeds(
  ids: string[],
  needs: Map<string, string[]>,
  order: Map<string, number>,
): string[] {
  const pendingNeeds = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const id of ids) {
    for (const dep of needs.get(id)!) {
      pendingNeeds.set(id, pendingNeeds.get(id)! + 1);
      dependents.get(dep)!.push(id);
    }
  }

  const byOrder = (a: string, b: string): number =>
    order.get(a)! - order.get(b)!;

  const ready = ids.filter((id) => pendingNeeds.get(id) === 0).sort(byOrder);
  const sorted: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    sorted.push(id);
    for (const dependent of dependents.get(id)!) {
      const remaining = pendingNeeds.get(dependent)! - 1;
      pendingNeeds.set(dependent, remaining);
      if (remaining === 0) {
        insertSorted(ready, dependent, byOrder);
      }
    }
  }

  if (sorted.length !== ids.length) {
    const cycle = ids.filter((id) => !sorted.includes(id));
    throw new Error(`Jobs form a \`needs\` cycle: ${cycle.join(', ')}`);
  }

  return sorted;
}

export function groupJobsByNeeds(jobs: Record<string, Job>): JobGroup[] {
  const entries = Object.entries(jobs);
  const ids = entries.map(([id]) => id);
  const order = new Map(ids.map((id, index) => [id, index]));
  const needs = new Map(
    entries.map(([id, job]) => [id, normaliseNeeds(job.needs)]),
  );

  for (const [id, deps] of needs) {
    for (const dep of deps) {
      if (!order.has(dep)) {
        throw new Error(`Job "${id}" needs unknown job "${dep}"`);
      }
    }
  }

  const component = findConnectedJobs(ids, needs);

  const groups = new Map<string, JobGroup>();
  for (const id of ids) {
    const root = component.get(id)!;
    let group = groups.get(root);
    if (!group) {
      group = { ids: [] };
      groups.set(root, group);
    }
    group.ids.push(id);
  }

  for (const group of groups.values()) {
    group.ids = orderByNeeds(group.ids, needs, order);
  }

  return [...groups.values()];
}

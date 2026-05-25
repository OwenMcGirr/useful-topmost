export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
}

export type TileState =
  | { kind: 'building' }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

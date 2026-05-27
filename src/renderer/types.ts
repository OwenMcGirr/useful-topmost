export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
  pinned?: boolean;
}

export type TileState =
  | { kind: 'building' }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

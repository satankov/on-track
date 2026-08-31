import type { Accent } from "./validation.js";

export interface Chat {
  id: string;
  title: string;
  accent: Accent;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  chatId: string;
  body: string;
  createdAt: number;
}

export interface ChatDetail extends Chat {
  notes: Note[];
}

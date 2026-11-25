import { h } from './dom';
import type { Bootstrap, WorkbenchPage } from './protocol';

export interface PageContext {
  state(): Bootstrap;
  text(en: string, zh: string, zhTw?: string): string;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  button(
    label: string,
    action: () => unknown,
    style?: string,
    disabled?: boolean,
  ): HTMLButtonElement;
  navigate(page: WorkbenchPage): Promise<void>;
  refresh(): Promise<void>;
  notify(message: string): void;
  error(error: unknown): void;
  current(): boolean;
}
export function field(label: string, control: HTMLElement, hint?: string) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('span', { class: 'field-hint' }, hint),
  );
}
export function input(name: string, value: string | number = '', type = 'text') {
  return h('input', { name, value, type });
}
export function select(name: string, value: string, options: [string, string][]) {
  return h(
    'select',
    { name },
    ...options.map(([id, label]) => h('option', { value: id, selected: id === value }, label)),
  );
}
export function heading(title: string, description?: string) {
  return h(
    'div',
    { class: 'page-heading' },
    h('h1', {}, title),
    description && h('p', { class: 'muted' }, description),
  );
}
export function blank(title: string, body?: string) {
  return h('div', { class: 'empty-state' }, h('h2', {}, title), body && h('p', {}, body));
}
export async function busy<T>(form: HTMLFormElement, task: () => Promise<T>) {
  if (form.dataset.busy) return;
  form.dataset.busy = 'true';
  const fields = [...form.querySelectorAll('fieldset')];
  const disabled = fields.map((f) => f.disabled);
  fields.forEach((f) => (f.disabled = true));
  try {
    return await task();
  } finally {
    delete form.dataset.busy;
    fields.forEach((f, i) => (f.disabled = disabled[i]));
  }
}

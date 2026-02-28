export enum EventNameEnum {
  sendQuestion = 'sendQuestion',
  editQuestion = 'editQuestion',
  openQuoteReader = 'openQuoteReader',
  showFullScreen3D = 'showFullScreen3D',
  refreshFeedback = 'refreshFeedback'
}

type EventHandler = (data?: Record<string, unknown>) => void;

export const eventBus = {
  list: new Map<EventNameEnum, EventHandler>(),
  on(name: EventNameEnum, fn: EventHandler) {
    this.list.set(name, fn);
  },
  emit(name: EventNameEnum, data: Record<string, unknown> = {}) {
    const fn = this.list.get(name);
    if (fn) fn(data);
  },
  off(name: EventNameEnum) {
    this.list.delete(name);
  }
};

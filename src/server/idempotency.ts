export function memoryIdempotencyKey(
  date: string,
  eventType: string,
  momentId: string,
): string {
  return `looki:memory:${date}:${eventType}:${momentId}`;
}

export function conversationIdempotencyKey(
  momentId: string,
  startTime: string,
): string {
  return `looki:conversation:${momentId}:${startTime}`;
}

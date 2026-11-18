export interface OperationNotice {
  day: string;
  title: string;
  introduction: string;
  items: { title: string; body: string }[];
  published_at: string;
}

export function noticeDate(day: string): string {
  return new Date(`${day}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

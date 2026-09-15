/** Owner: no religion in the product. */

const RELIGION_TEXT = /gudstjeneste|kirkekonsert|menighet|\b\w*kirke\b/i;

export function isReligionItem(item) {
  const cats = item?.categories || [];
  if (cats.includes("church")) return true;
  const blob = [
    item?.name,
    item?.title,
    item?.venue,
    item?.attrs?.venue,
    item?.attrs?.description,
    item?.attrs?.curatedNote,
  ]
    .filter(Boolean)
    .join(" ");
  return RELIGION_TEXT.test(blob);
}

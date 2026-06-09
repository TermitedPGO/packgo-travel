/**
 * inquiryLabels — plain-Chinese labels for InquiryAgent classifications.
 *
 * Why this exists: the inbox cards Jeff reads were leaking raw internal
 * enum values ("quote_request") and policy jargon
 * ("classification=X → policy.action=escalate"). Jeff's rule: the inbox
 * must read like a human assistant, not a system log. This map is the one
 * place that turns an internal classification into something a person reads.
 *
 * Keep the labels SHORT (2-5 chars) and plain. No English, no punctuation
 * jargon, no em dashes.
 */

export const INQUIRY_CLASSIFICATION_LABELS_ZH: Record<string, string> = {
  new_inquiry: "新詢問",
  booking_question: "訂單問題",
  complaint: "客訴",
  refund_request: "退款",
  general_info: "一般詢問",
  spam: "疑似垃圾",
  other: "其他",
  quote_request: "報價",
  flight_inquiry: "機票",
  tour_comparison_request: "行程比較",
  visa_inquiry: "簽證",
  deposit_inquiry: "訂金",
};

/**
 * Plain-Chinese label for a classification. Falls back to the raw value
 * (never throws) so an unseen future intent still renders something.
 */
export function inquiryClassificationLabelZh(classification: string): string {
  return INQUIRY_CLASSIFICATION_LABELS_ZH[classification] ?? classification;
}

/**
 * A plain-Chinese, human-readable reason for why an inquiry was escalated
 * to Jeff instead of auto-handled. Replaces the old
 * `classification=X → policy.action=escalate` log-speak. Written in Jeff's
 * voice rule: short, plain, says what it is + why he is seeing it.
 */
export function escalationReasonZh(classification: string): string {
  const label = inquiryClassificationLabelZh(classification);
  switch (classification) {
    case "refund_request":
      return `這是退款的事,照規矩一定要你親自決定,我沒自動回。`;
    case "complaint":
      return `客人在抱怨,這種我不自己回,先讓你看過。`;
    case "spam":
      return `看起來像垃圾信,但我不確定,留給你判斷。`;
    default:
      return `這封我歸成「${label}」,超出我能自動處理的範圍,先給你看。`;
  }
}

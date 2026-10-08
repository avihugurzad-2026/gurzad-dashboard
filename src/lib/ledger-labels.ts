// Labels shared by the server and client finance screens (plain module: no 'use client')
export const FREQ_LABEL: Record<string, string> = {
  one_time: 'חד-פעמי', monthly: 'חודשי', bimonthly: 'דו-חודשי', quarterly: 'רבעוני', yearly: 'שנתי', custom: 'מותאם',
};
export const ACCOUNT_LABEL: Record<string, string> = {
  bank: 'חשבון בנק', credit_card: 'כרטיס אשראי', cash: 'מזומן', savings: 'חיסכון', investment: 'השקעות', loan: 'הלוואה', other: 'אחר',
};

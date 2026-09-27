import type { DividerContent } from '@/lib/types';

export default function DividerBlock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _: { content: DividerContent; onUpdate: (content: DividerContent) => void; readOnly: boolean }
) {
  return <hr className="border-t border-gray-200 my-4" />;
}

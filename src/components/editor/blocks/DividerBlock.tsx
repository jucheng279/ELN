interface DividerBlockProps {
  content: any;
  onUpdate: (content: any) => void;
  readOnly: boolean;
}

export default function DividerBlock({
  content,
  onUpdate,
  readOnly,
}: DividerBlockProps) {
  return <hr className="border-t border-gray-200 my-4" />;
}

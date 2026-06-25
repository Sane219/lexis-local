import { useRef } from "react";

interface FilePickerProps {
  onFile: (name: string, bytes: Uint8Array) => void;
  disabled?: boolean;
}

export function FilePicker({ onFile, disabled }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    onFile(file.name, new Uint8Array(buf));
    e.target.value = "";
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        onChange={handleChange}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
      >
        Open PDF
      </button>
    </div>
  );
}

interface FilePickerProps {
  onOpen: () => void;
  disabled?: boolean;
}

export function FilePicker({ onOpen, disabled }: FilePickerProps) {
  return (
    <button
      onClick={onOpen}
      disabled={disabled}
      title={disabled ? "Ingesting…" : undefined}
      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
    >
      Open PDF
    </button>
  );
}

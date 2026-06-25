interface DocInfo {
  id: string;
  name: string;
  page_count: number;
  raw_text: string;
  created_at: string;
}

interface DocumentListProps {
  documents: DocInfo[];
  selectedId: string | null;
  onSelect: (doc: DocInfo) => void;
}

export function DocumentList({
  documents,
  selectedId,
  onSelect,
}: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <p className="text-gray-400 text-sm">No documents ingested yet.</p>
    );
  }

  return (
    <ul className="space-y-1">
      {documents.map((doc) => (
        <li key={doc.id}>
          <button
            onClick={() => onSelect(doc)}
            className={`w-full text-left px-3 py-2 rounded text-sm cursor-pointer ${
              selectedId === doc.id
                ? "bg-blue-100 text-blue-900"
                : "hover:bg-gray-100 text-gray-800"
            }`}
          >
            <div className="font-medium truncate">{doc.name}</div>
            <div className="text-xs text-gray-400">
              {doc.page_count} page{doc.page_count !== 1 ? "s" : ""}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

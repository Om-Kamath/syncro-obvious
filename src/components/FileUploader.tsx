import React, { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FileUploaderProps {
  onFilesAdded: (files: File[]) => void;
  onRejected?: (files: File[]) => void;
  accept: Record<string, string[]>;
  label: string;
  icon?: React.ReactNode;
  multiple?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onFilesAdded,
  onRejected,
  accept,
  label,
  icon = <Upload className="w-8 h-8" />,
  multiple = true,
}) => {
  const onDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
    onFilesAdded(acceptedFiles);
    if (onRejected && fileRejections.length > 0) {
      onRejected(fileRejections.map(rejection => rejection.file));
    }
  }, [onFilesAdded, onRejected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple,
  });

  return (
    <div
      {...getRootProps()}
      data-media-dropzone="true"
      className={cn(
        "relative group cursor-pointer border-2 border-dashed rounded-2xl p-8 transition-all duration-300",
        "flex flex-col items-center justify-center gap-4 text-center",
        isDragActive
          ? "border-violet-500 bg-violet-100"
          : "border-violet-300 hover:border-violet-400 bg-violet-50 hover:bg-violet-100"
      )}
    >
      <input {...getInputProps()} aria-label={label} />
      <div className={cn(
        "p-4 rounded-full transition-transform duration-300 group-hover:scale-110",
        isDragActive ? "bg-violet-200 text-violet-700" : "bg-violet-200 text-violet-600"
      )}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        <p className="text-xs text-gray-400 mt-1">
          {isDragActive ? "Drop files here" : "Drag & drop or click to select"}
        </p>
      </div>
    </div>
  );
};

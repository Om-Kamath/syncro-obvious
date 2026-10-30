export interface PartitionedMedia {
  videos: File[];
  audios: File[];
  images: File[];
  rejected: File[];
}

/**
 * Route dropped files by MIME type into the media kind Syncro knows how to
 * import. Everything outside the video/audio/image families is rejected so
 * the caller can surface it (error toast) instead of dropping it silently.
 */
export function partitionDroppedFiles(files: File[]): PartitionedMedia {
  const partitioned: PartitionedMedia = { videos: [], audios: [], images: [], rejected: [] };
  for (const file of files) {
    const type = file.type.toLowerCase();
    if (type.startsWith('video/')) partitioned.videos.push(file);
    else if (type.startsWith('audio/')) partitioned.audios.push(file);
    else if (type.startsWith('image/')) partitioned.images.push(file);
    else partitioned.rejected.push(file);
  }
  return partitioned;
}

// 媒体上传：小文件直传，大文件分片。前台内容编辑与管理后台共用。依赖 core.js。

const DIRECT_MEDIA_UPLOAD_LIMIT = 8 * 1024 * 1024;

// 内容编辑与管理后台共用的媒体上传：小文件直传，大文件走分片。
// apiBase 为 "/api/content" 或 "/api/admin"，两侧接口形状一致。
async function uploadMediaViaApi(apiBase, file, path, onProgress) {
  if (file.size <= DIRECT_MEDIA_UPLOAD_LIMIT) {
    const response = await fetch(`${apiBase}/media/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError(data.error || `上传失败：${response.status}`, response.status);
    onProgress?.(file.size, file.size);
    return data;
  }

  return uploadMultipartViaApi(apiBase, file, path, onProgress);
}

async function uploadMultipartViaApi(apiBase, file, path, onProgress) {
  const init = await fetchJson(`${apiBase}/uploads/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });

  const parts = [];
  const partSize = init.partSize || DIRECT_MEDIA_UPLOAD_LIMIT;
  let uploaded = 0;

  try {
    for (let offset = 0, partNumber = 1; offset < file.size; offset += partSize, partNumber += 1) {
      const chunk = file.slice(offset, Math.min(file.size, offset + partSize));
      const response = await fetch(
        `${apiBase}/uploads/part?path=${encodeURIComponent(path)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: chunk,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw httpError(data.error || `分片上传失败：${response.status}`, response.status);
      parts.push(data);
      uploaded += chunk.size;
      onProgress?.(uploaded, file.size);
    }

    return fetchJson(`${apiBase}/uploads/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
        parts,
      }),
    });
  } catch (error) {
    await fetchJson(`${apiBase}/uploads/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
      }),
    }).catch(() => {});
    throw error;
  }
}

function uploadPercent(loaded, total) {
  if (!total) return "0%";
  return `${Math.min(100, Math.round((loaded / total) * 100))}%`;
}

Object.assign(window.blog, {
  uploadMediaViaApi,
  uploadPercent,
});

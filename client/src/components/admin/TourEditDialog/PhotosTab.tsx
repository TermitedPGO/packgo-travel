/**
 * v2 Wave 2 Module 2.12 — Photos tab.
 *
 * Verbatim JSX extraction from TourEditDialog L1801-2041. State + upload
 * helpers + file-input ref pulled from the shared edit context.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Upload, Image, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";

export default function PhotosTab() {
  const { t } = useLocale();
  const {
    editedData,
    setEditedData,
    uploadingImages,
    setUploadingImages,
    isDraggingOver,
    setIsDraggingOver,
    fileInputRef,
    uploadImageFile,
    handleDropImages,
  } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.tourPhotos')}</h3>
            <p className="text-xs text-foreground/60 mt-1">{t('tourEditDialog.uploadHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('tourEditDialog.uploadButton')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const newImage = { url: '', alt: '', caption: '' };
                setEditedData({
                  ...editedData,
                  images: [...(editedData.images || []), newImage]
                });
              }}
              className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('tourEditDialog.addPhoto')}
            </Button>
          </div>
        </div>

        {/* 隱藏的 file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            if (e.target.files && e.target.files.length > 0) {
              await handleDropImages(e.target.files);
              e.target.value = '';
            }
          }}
        />

        {/* 拖曳上傳區域 */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            isDraggingOver ? 'border-[#c9a563] bg-[#FAF8F2]' : 'border-gray-300 hover:border-[#c9a563]/50 hover:bg-gray-50'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files.length > 0) {
              await handleDropImages(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm font-medium text-gray-600">{t('tourEditDialog.dragDropHint')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('tourEditDialog.dragDropSub')}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {editedData.images?.map((image: any, index: number) => (
            <div key={index} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">{t('tourEditDialog.photoLabel').replace('{n}', String(index + 1))}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const updated = [...editedData.images];
                    updated.splice(index, 1);
                    setEditedData({ ...editedData, images: updated });
                  }}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* 圖片預覽或上傳中狀態 */}
              {uploadingImages[index] ? (
                <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-sm text-foreground/60">{t('tourEditDialog.uploading')}</span>
                </div>
              ) : image.url ? (
                <div className="relative overflow-hidden rounded-lg group">
                  <img
                    src={image.url}
                    alt={image.alt || t('tourEditDialog.tourPhotoAlt')}
                    className="w-full h-32 object-cover rounded-lg"
                  />
                  {/* 替換圖片按鈕 */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                    <label className="cursor-pointer bg-white text-foreground text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100">
                      <Upload className="h-3 w-3 inline mr-1" />
                      {t('tourEditDialog.replaceImage')}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          if (e.target.files?.[0]) {
                            setUploadingImages(prev => ({ ...prev, [index]: true }));
                            const url = await uploadImageFile(e.target.files![0], index);
                            setUploadingImages(prev => ({ ...prev, [index]: false }));
                            if (url) {
                              const updated = [...editedData.images];
                              updated[index] = { ...updated[index], url };
                              setEditedData({ ...editedData, images: updated });
                            }
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="w-full h-32 bg-white border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 hover:border-[#c9a563]/50">
                  <Upload className="h-6 w-6 text-gray-400 mb-1" />
                  <span className="text-xs text-foreground/60">{t('tourEditDialog.clickToUpload')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      if (e.target.files?.[0]) {
                        setUploadingImages(prev => ({ ...prev, [index]: true }));
                        const url = await uploadImageFile(e.target.files![0], index);
                        setUploadingImages(prev => ({ ...prev, [index]: false }));
                        if (url) {
                          const updated = [...editedData.images];
                          updated[index] = { ...updated[index], url };
                          setEditedData({ ...editedData, images: updated });
                        }
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              )}

              <div>
                <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.imageUrlLabel')}</Label>
                <Input
                  value={image.url || ''}
                  onChange={(e) => {
                    const updated = [...editedData.images];
                    updated[index] = { ...updated[index], url: e.target.value };
                    setEditedData({ ...editedData, images: updated });
                  }}
                  className="mt-1 h-8 text-sm"
                  placeholder="https://..."
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.photoAlt')}</Label>
                <Input
                  value={image.alt || ''}
                  onChange={(e) => {
                    const updated = [...editedData.images];
                    updated[index] = { ...updated[index], alt: e.target.value };
                    setEditedData({ ...editedData, images: updated });
                  }}
                  className="mt-1 h-8 text-sm"
                  placeholder={t('tourEditDialog.photoAltPlaceholder')}
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.photoCaption')}</Label>
                <Input
                  value={image.caption || ''}
                  onChange={(e) => {
                    const updated = [...editedData.images];
                    updated[index] = { ...updated[index], caption: e.target.value };
                    setEditedData({ ...editedData, images: updated });
                  }}
                  className="mt-1 h-8 text-sm"
                  placeholder={t('tourEditDialog.photoCaptionPlaceholder')}
                />
              </div>
            </div>
          ))}
        </div>

        {(!editedData.images || editedData.images.length === 0) && (
          <div className="text-center py-8 text-gray-400">
            <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">{t('tourEditDialog.noPhotos')}</p>
            <p className="text-xs mt-1">{t('tourEditDialog.noPhotosHint')}</p>
          </div>
        )}
      </div>

      {/* Hero 圖片設定 */}
      <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.heroImage')}</h3>

        <div className="space-y-4">
          <div>
            <Label htmlFor="heroImage" className="text-sm font-medium">
              {t('tourEditDialog.heroImageUrl')}
            </Label>
            <Input
              id="heroImage"
              value={editedData.heroImage || ''}
              onChange={(e) => setEditedData({ ...editedData, heroImage: e.target.value })}
              className="mt-2"
              placeholder="https://..."
            />
          </div>

          {editedData.heroImage && (
            <div className="relative rounded-lg overflow-hidden">
              <img
                src={editedData.heroImage}
                alt="Hero Preview"
                className="w-full h-48 object-cover rounded-lg"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Upload, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

interface AvatarUploadProps {
  currentAvatar?: string;
  onUploadComplete: (avatarUrl: string) => void;
  onDelete?: () => void;
}

export default function AvatarUpload({ currentAvatar, onUploadComplete, onDelete }: AvatarUploadProps) {
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setImageSrc(reader.result as string);
        setIsOpen(true);
      });
      reader.readAsDataURL(file);
    }
  };

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", (error) => reject(error));
      image.src = url;
    });

  const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: any
  ): Promise<Blob> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("No 2d context");
    }

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas is empty"));
          return;
        }
        resolve(blob);
      }, "image/jpeg");
    });
  };

  const handleUpload = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setIsUploading(true);
    try {
      // Get cropped image blob
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(croppedBlob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;

        // Upload to S3 via backend API
        const response = await fetch("/api/upload-avatar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ image: base64data }),
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const data = await response.json();
        onUploadComplete(data.url);
        setIsOpen(false);
        setImageSrc(null);
      };
    } catch (error) {
      console.error("Error uploading avatar:", error);
      alert(t('profile.avatarUploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <div className="relative group">
        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg bg-gray-200">
          {currentAvatar ? (
            <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover rounded-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-black text-white text-3xl font-bold">
              <Upload className="h-8 w-8 text-white" />
            </div>
          )}
        </div>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
          <label
            htmlFor="avatar-upload"
            className="cursor-pointer p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
          >
            <Upload className="h-5 w-5 text-white" />
          </label>
          {currentAvatar && onDelete && (
            <button
              onClick={onDelete}
              className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
              title={t('profile.deleteAvatar')}
            >
              <X className="h-5 w-5 text-white" />
            </button>
          )}
        </div>
        <input
          id="avatar-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl ">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">{t('profile.cropAvatar')}</DialogTitle>
          </DialogHeader>
          <div className="relative h-96 bg-gray-100 ">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {t('profile.zoom')}
              </label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setIsOpen(false);
                setImageSrc(null);
              }}
              className="rounded-lg border-2 border-black"
            >
              <X className="h-4 w-4 mr-2" />
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading}
              className="rounded-lg bg-black text-white hover:bg-gray-800"
            >
              <Upload className="h-4 w-4 mr-2" />
              {isUploading ? t('profile.uploading') : t('profile.uploadAvatar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

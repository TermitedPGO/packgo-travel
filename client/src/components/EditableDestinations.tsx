import { ArrowRight, Pencil, Plus, Trash2, GripVertical, X, Check, Upload, ImageIcon } from "lucide-react";
import { useLocation } from "wouter";
import { useHomeEdit } from "@/contexts/HomeEditContext";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Destination {
  id: number;
  name: string;
  label: string | null;
  image: string | null;
  region: string | null;
  sortOrder: number;
  isActive: boolean;
}

// v70: defaults now use translation keys for `name` so EN locale doesn't show
// Chinese fallbacks. Keys reference the existing `destinations.*` block.
const buildDefaultDestinations = (
  t: (k: string) => string
): Array<{ id: number; name: string; image: string; label: string; region: string }> => [
  { id: 1, name: t('destinations.europe'),     image: "/images/dest-europe.webp",        label: "Europe",      region: "europe" },
  { id: 2, name: t('destinations.asia'),       image: "/images/dest-asia.webp",          label: "Asia",        region: "asia" },
  { id: 3, name: t('destinations.americas'),   image: "/images/dest-southamerica.webp",  label: "Americas",    region: "south-america" },
  { id: 4, name: t('destinations.middleEast'), image: "/images/dest-israel.webp",        label: "Middle East", region: "middle-east" },
  { id: 5, name: t('destinations.africa'),     image: "/images/dest-africa.webp",        label: "Africa",      region: "africa" },
  { id: 6, name: t('destinations.cruises'),    image: "/images/dest-cruise.webp",        label: "Cruises",     region: "cruise" },
];

export default function EditableDestinations() {
  const [, setLocation] = useLocation();
  const { isEditMode, canEdit } = useHomeEdit();
  const { t, language } = useLocale();
  const isChineseMode = language === 'zh-TW';
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Destination>>({});
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch destinations from database
  const { data: dbDestinations, refetch } = trpc.homepage.getDestinations.useQuery();
  
  const updateMutation = trpc.homepage.updateDestination.useMutation({
    onSuccess: () => {
      toast.success(t('editableDestinations.toastUpdated'));
      setEditingId(null);
      refetch();
    },
    onError: (error) => {
      toast.error(t('editableDestinations.toastUpdateFailed') + ': ' + error.message);
    },
  });

  const createMutation = trpc.homepage.createDestination.useMutation({
    onSuccess: () => {
      toast.success(t('editableDestinations.toastCreated'));
      setShowAddDialog(false);
      setEditForm({});
      refetch();
    },
    onError: (error) => {
      toast.error(t('editableDestinations.toastCreateFailed') + ': ' + error.message);
    },
  });

  const deleteMutation = trpc.homepage.deleteDestination.useMutation({
    onSuccess: () => {
      toast.success(t('editableDestinations.toastDeleted'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('editableDestinations.toastDeleteFailed') + ': ' + error.message);
    },
  });

  // Use database destinations or default. v70: defaults are now locale-aware.
  const destinations = dbDestinations || buildDefaultDestinations(t);

  const handleDestinationClick = (region: string) => {
    if (!isEditMode) {
      // 導向國家分類頁面，讓用戶先選擇國家
      setLocation(`/destinations/${region}`);
    }
  };

  const handleEdit = (dest: Destination) => {
    setEditingId(dest.id);
    setEditForm({
      name: dest.name,
      label: dest.label || '',
      image: dest.image || '',
      region: dest.region || '',
      isActive: dest.isActive,
    });
  };

  const handleSave = () => {
    if (editingId && editForm.name) {
      updateMutation.mutate({
        id: editingId,
        name: editForm.name,
        label: editForm.label || undefined,
        image: editForm.image || undefined,
        region: editForm.region || undefined,
        isActive: editForm.isActive,
      });
    }
  };

  const handleCreate = () => {
    if (editForm.name) {
      createMutation.mutate({
        name: editForm.name,
        label: editForm.label || undefined,
        image: editForm.image || undefined,
        region: editForm.region || undefined,
        isActive: editForm.isActive ?? true,
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm(t('editableDestinations.deleteConfirm'))) {
      deleteMutation.mutate({ id });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('editableDestinations.toastImageOnly'));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('editableDestinations.toastImageMaxSize'));
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'destination');

      const response = await fetch('/api/upload/tour-image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('editableDestinations.toastUploadFailed'));
      }

      const data = await response.json();
      setEditForm(prev => ({ ...prev, image: data.url }));
      toast.success(t('editableDestinations.toastUploadSuccess'));
    } catch (error) {
      toast.error(t('editableDestinations.toastUploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section id="destinations" className="py-20 bg-gray-50">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4 relative inline-block">
            {t('destinations.title')}
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary"></span>
          </h2>
          <p className="text-gray-500 mt-4">{t('destinations.subtitle')}</p>
        </div>

        {/* Add Button */}
        {isEditMode && canEdit && (
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                setEditForm({ isActive: true });
                setShowAddDialog(true);
              }}
              className="bg-black hover:bg-gray-800"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('editableDestinations.addButton')}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {destinations.map((dest) => (
            <div 
              key={dest.id} 
              onClick={() => handleDestinationClick(dest.region || '')}
              className={`group relative aspect-[4/3] overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-all duration-500 ${
                isEditMode ? 'cursor-default' : 'cursor-pointer'
              }`}
            >
              <img 
                src={dest.image || '/images/placeholder.jpg'} 
                alt={dest.name} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 rounded-xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
              
              <div className="absolute bottom-0 left-0 w-full p-6 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
                {/* In Chinese mode: show Chinese name (large) + English label (small) */}
                {/* In English mode: show English label (large) only */}
                <h3 className="text-2xl font-bold text-white mb-1">
                  {isChineseMode ? dest.name : (dest.label || dest.name)}
                </h3>
                {isChineseMode && (
                  <p className="text-gray-300 text-sm uppercase tracking-wider mb-4">{dest.label}</p>
                )}
                {!isEditMode && (
                  <div className="flex items-center text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                    {t('destinations.viewTours')} <ArrowRight className="ml-2 h-4 w-4" />
                  </div>
                )}
              </div>

              {/* Edit Controls */}
              {isEditMode && canEdit && (
                <div className="absolute top-4 right-4 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(dest as Destination);
                    }}
                    className="bg-black/70 hover:bg-black text-white p-2 rounded-lg transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(dest.id);
                    }}
                    className="bg-red-600/70 hover:bg-red-600 text-white p-2 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editableDestinations.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('editableDestinations.nameLabel')}</Label>
              <Input
                value={editForm.name || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('editableDestinations.placeholderName')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.englishLabel')}</Label>
              <Input
                value={editForm.label || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder={t('editableDestinations.placeholderEnglishLabel')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.regionLabel')}</Label>
              <Input
                value={editForm.region || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, region: e.target.value }))}
                placeholder={t('editableDestinations.placeholderRegion')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.imageLabel')}</Label>
              <div className="mt-1 space-y-2">
                {editForm.image && (
                  <img src={editForm.image} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex-1"
                  >
                    {isUploading ? t('editableDestinations.uploadingButton') : t('editableDestinations.uploadButton')}
                  </Button>
                  <Input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>
                <Input
                  value={editForm.image || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                  placeholder={t('editableDestinations.placeholderImageUrl')}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>{t('editableDestinations.isActiveLabel')}</Label>
              <Switch
                checked={editForm.isActive ?? true}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked }))}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} disabled={updateMutation.isPending} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                {t('editableDestinations.saveButton')}
              </Button>
              <Button variant="outline" onClick={() => setEditingId(null)} className="flex-1">
                <X className="h-4 w-4 mr-2" />
                {t('editableDestinations.cancelButton')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editableDestinations.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('editableDestinations.nameLabelRequired')}</Label>
              <Input
                value={editForm.name || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('editableDestinations.placeholderName')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.englishLabel')}</Label>
              <Input
                value={editForm.label || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder={t('editableDestinations.placeholderEnglishLabel')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.regionLabel')}</Label>
              <Input
                value={editForm.region || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, region: e.target.value }))}
                placeholder={t('editableDestinations.placeholderRegion')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('editableDestinations.imageLabel')}</Label>
              <div className="mt-1 space-y-2">
                {editForm.image && (
                  <img src={editForm.image} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex-1"
                  >
                    {isUploading ? t('editableDestinations.uploadingButton') : t('editableDestinations.uploadButton')}
                  </Button>
                </div>
                <Input
                  value={editForm.image || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                  placeholder={t('editableDestinations.placeholderImageUrl')}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>{t('editableDestinations.isActiveLabel')}</Label>
              <Switch
                checked={editForm.isActive ?? true}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked }))}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleCreate} disabled={createMutation.isPending || !editForm.name} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                {t('editableDestinations.addNewButton')}
              </Button>
              <Button variant="outline" onClick={() => setShowAddDialog(false)} className="flex-1">
                <X className="h-4 w-4 mr-2" />
                {t('editableDestinations.cancelButton')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

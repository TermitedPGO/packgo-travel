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

const defaultDestinations = [
  { id: 1, name: "歐洲地區", image: "/images/dest-europe.webp", label: "Europe", region: "europe" },
  { id: 2, name: "亞洲地區", image: "/images/dest-asia.webp", label: "Asia", region: "asia" },
  { id: 3, name: "美洲地區", image: "/images/dest-southamerica.webp", label: "Americas", region: "south-america" },
  { id: 4, name: "中東地區", image: "/images/dest-israel.webp", label: "Middle East", region: "middle-east" },
  { id: 5, name: "非洲地區", image: "/images/dest-africa.webp", label: "Africa", region: "africa" },
  { id: 6, name: "郵輪之旅", image: "/images/dest-cruise.webp", label: "Cruises", region: "cruise" },
];

export default function EditableDestinations() {
  const [, setLocation] = useLocation();
  const { isEditMode, canEdit } = useHomeEdit();
  const { t, language } = useLocale();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Destination>>({});
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch destinations from database
  const { data: dbDestinations, refetch } = trpc.homepage.getDestinations.useQuery();
  
  const updateMutation = trpc.homepage.updateDestination.useMutation({
    onSuccess: () => {
      toast.success('目的地已更新');
      setEditingId(null);
      refetch();
    },
    onError: (error) => {
      toast.error('更新失敗: ' + error.message);
    },
  });

  const createMutation = trpc.homepage.createDestination.useMutation({
    onSuccess: () => {
      toast.success('目的地已新增');
      setShowAddDialog(false);
      setEditForm({});
      refetch();
    },
    onError: (error) => {
      toast.error('新增失敗: ' + error.message);
    },
  });

  const deleteMutation = trpc.homepage.deleteDestination.useMutation({
    onSuccess: () => {
      toast.success('目的地已刪除');
      refetch();
    },
    onError: (error) => {
      toast.error('刪除失敗: ' + error.message);
    },
  });

  // Use database destinations or default
  const destinations = dbDestinations || defaultDestinations;

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
    if (confirm('確定要刪除這個目的地嗎？')) {
      deleteMutation.mutate({ id });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('請選擇圖片檔案');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('圖片大小不能超過 10MB');
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
        throw new Error('上傳失敗');
      }

      const data = await response.json();
      setEditForm(prev => ({ ...prev, image: data.url }));
      toast.success('圖片上傳成功');
    } catch (error) {
      toast.error('圖片上傳失敗');
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
              新增目的地
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
                <h3 className="text-2xl font-bold text-white mb-1">{dest.name}</h3>
                <p className="text-gray-300 text-sm uppercase tracking-wider mb-4">{dest.label}</p>
                {!isEditMode && (
                  <div className="flex items-center text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                    查看行程 <ArrowRight className="ml-2 h-4 w-4" />
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
            <DialogTitle>編輯目的地</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>名稱</Label>
              <Input
                value={editForm.name || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：歐洲"
                className="mt-1"
              />
            </div>
            <div>
              <Label>英文標籤</Label>
              <Input
                value={editForm.label || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="例如：Europe"
                className="mt-1"
              />
            </div>
            <div>
              <Label>區域代碼</Label>
              <Input
                value={editForm.region || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, region: e.target.value }))}
                placeholder="例如：europe"
                className="mt-1"
              />
            </div>
            <div>
              <Label>圖片</Label>
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
                    {isUploading ? '上傳中...' : '上傳圖片'}
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
                  placeholder="或輸入圖片網址"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>顯示在首頁</Label>
              <Switch
                checked={editForm.isActive ?? true}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked }))}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} disabled={updateMutation.isPending} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                儲存
              </Button>
              <Button variant="outline" onClick={() => setEditingId(null)} className="flex-1">
                <X className="h-4 w-4 mr-2" />
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增目的地</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>名稱 *</Label>
              <Input
                value={editForm.name || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：歐洲"
                className="mt-1"
              />
            </div>
            <div>
              <Label>英文標籤</Label>
              <Input
                value={editForm.label || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="例如：Europe"
                className="mt-1"
              />
            </div>
            <div>
              <Label>區域代碼</Label>
              <Input
                value={editForm.region || ''}
                onChange={(e) => setEditForm(prev => ({ ...prev, region: e.target.value }))}
                placeholder="例如：europe"
                className="mt-1"
              />
            </div>
            <div>
              <Label>圖片</Label>
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
                    {isUploading ? '上傳中...' : '上傳圖片'}
                  </Button>
                </div>
                <Input
                  value={editForm.image || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, image: e.target.value }))}
                  placeholder="或輸入圖片網址"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>顯示在首頁</Label>
              <Switch
                checked={editForm.isActive ?? true}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked }))}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleCreate} disabled={createMutation.isPending || !editForm.name} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                新增
              </Button>
              <Button variant="outline" onClick={() => setShowAddDialog(false)} className="flex-1">
                <X className="h-4 w-4 mr-2" />
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { User } from "../drizzle/schema";

// Mock user data
const mockAdminUser: User = {
  id: 1,
  openId: "test-admin-openid",
  name: "Test Admin",
  email: "admin@test.com",
  loginMethod: "google",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const mockRegularUser: User = {
  id: 2,
  openId: "test-user-openid",
  name: "Test User",
  email: "user@test.com",
  loginMethod: "google",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

// Mock context
const createMockContext = (user?: User) => ({
  user,
  req: {} as any,
  res: {} as any,
});

describe.skipIf(!process.env.DATABASE_URL)("Tours API", () => {
  let testTourId: number;

  describe("tours.list", () => {
    it("should return all tours (public access)", async () => {
      const caller = appRouter.createCaller(createMockContext());
      const tours = await caller.tours.list();
      expect(Array.isArray(tours)).toBe(true);
    });

    it("should work without authentication", async () => {
      const caller = appRouter.createCaller(createMockContext(undefined));
      const tours = await caller.tours.list();
      expect(Array.isArray(tours)).toBe(true);
    });
  });

  describe("tours.create (admin only)", () => {
    it("should create a tour when user is admin", async () => {
      const caller = appRouter.createCaller(createMockContext(mockAdminUser));
      
      const newTour = await caller.tours.create({
        title: "測試行程 - 東京賞櫻",
        destination: "日本東京",
        destinationCountry: "日本",
        destinationCity: "東京",
        description: "這是一個測試行程，包含東京賞櫻的完整體驗",
        duration: 5,
        price: 35000,
        category: "group",
        status: "active",
        featured: 0,
        imageUrl: "https://example.com/test-image.jpg",
        highlights: "賞櫻名所巡禮\n品嚐日式料理\n溫泉體驗",
        includes: "來回機票\n飯店住宿\n早餐",
        excludes: "午晚餐\n個人消費",
      });

      expect(newTour).toBeDefined();
      expect(newTour.title).toBe("測試行程 - 東京賞櫻");
      expect(newTour.destination).toBe("日本東京");
      expect(newTour.price).toBe(35000);
      expect(newTour.createdBy).toBe(mockAdminUser.id);
      
      testTourId = newTour.id;
    });

    it("should fail when user is not admin", async () => {
      const caller = appRouter.createCaller(createMockContext(mockRegularUser));
      
      await expect(
        caller.tours.create({
          title: "測試行程",
          destination: "測試目的地",
          destinationCountry: "測試國家",
          destinationCity: "測試城市",
          description: "測試描述",
          duration: 5,
          price: 10000,
          category: "group",
          status: "active",
          featured: 0,
        })
      ).rejects.toThrow();
    });

    it("should fail when user is not authenticated", async () => {
      const caller = appRouter.createCaller(createMockContext(undefined));
      
      await expect(
        caller.tours.create({
          title: "測試行程",
          destination: "測試目的地",
          destinationCountry: "測試國家",
          destinationCity: "測試城市",
          description: "測試描述",
          duration: 5,
          price: 10000,
          category: "group",
          status: "active",
          featured: 0,
        })
      ).rejects.toThrow();
    });
  });

  describe("tours.getById", () => {
    it("should return a tour by ID (public access)", async () => {
      // First create a tour to test with
      const adminCaller = appRouter.createCaller(createMockContext(mockAdminUser));
      const newTour = await adminCaller.tours.create({
        title: "測試行程 - 大阪美食",
        destination: "日本大阪",
        destinationCountry: "日本",
        destinationCity: "大阪",
        description: "大阪美食探索之旅",
        duration: 4,
        price: 28000,
        category: "theme",
        status: "active",
        featured: 0,
      });

      // Now test getting it
      const publicCaller = appRouter.createCaller(createMockContext());
      const tour = await publicCaller.tours.getById({ id: newTour.id });
      
      expect(tour).toBeDefined();
      expect(tour.id).toBe(newTour.id);
      expect(tour.title).toBe("測試行程 - 大阪美食");
    });

    it("should throw error when tour not found", async () => {
      const caller = appRouter.createCaller(createMockContext());
      
      await expect(
        caller.tours.getById({ id: 999999 })
      ).rejects.toThrow("Tour not found");
    });
  });

  describe("tours.update (admin only)", () => {
    it("should update a tour when user is admin", async () => {
      // First create a tour
      const caller = appRouter.createCaller(createMockContext(mockAdminUser));
      const newTour = await caller.tours.create({
        title: "原始標題",
        destination: "原始目的地",
        destinationCountry: "原始國家",
        destinationCity: "原始城市",
        description: "原始描述",
        duration: 5,
        price: 30000,
        category: "group",
        status: "active",
        featured: 0,
      });

      // Update it
      const updatedTour = await caller.tours.update({
        id: newTour.id,
        title: "更新後的標題",
        price: 35000,
        status: "inactive",
      });

      expect(updatedTour.title).toBe("更新後的標題");
      expect(updatedTour.price).toBe(35000);
      expect(updatedTour.status).toBe("inactive");
      expect(updatedTour.destination).toBe("原始目的地"); // Should remain unchanged
    });

    it("should fail when user is not admin", async () => {
      const caller = appRouter.createCaller(createMockContext(mockRegularUser));
      
      await expect(
        caller.tours.update({
          id: 1,
          title: "嘗試更新",
        })
      ).rejects.toThrow();
    });
  });

  describe("tours.delete (admin only)", () => {
    it("should delete a tour when user is admin", async () => {
      // First create a tour
      const caller = appRouter.createCaller(createMockContext(mockAdminUser));
      const newTour = await caller.tours.create({
        title: "待刪除的行程",
        destination: "測試目的地",
        destinationCountry: "測試國家",
        destinationCity: "測試城市",
        description: "這個行程將被刪除",
        duration: 3,
        price: 20000,
        category: "custom",
        status: "active",
        featured: 0,
      });

      // Delete it
      const result = await caller.tours.delete({ id: newTour.id });
      expect(result.success).toBe(true);

      // Verify it's deleted
      const tour = await db.getTourById(newTour.id);
      expect(tour).toBeUndefined();
    });

    it("should fail when user is not admin", async () => {
      const caller = appRouter.createCaller(createMockContext(mockRegularUser));
      
      await expect(
        caller.tours.delete({ id: 1 })
      ).rejects.toThrow();
    });
  });
});

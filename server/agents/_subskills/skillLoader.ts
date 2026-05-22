/**
 * Skill Loader v2
 * 
 * Based on Anthropic's Agent Skills architecture:
 * - Progressive Disclosure: Load only what's needed
 * - YAML Frontmatter: Skill metadata
 * - Dynamic Discovery: Auto-scan skills directory
 * - Reference Resolution: Load referenced skills
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface SkillMetadata {
  name: string;
  description: string;
  model: 'opus' | 'sonnet' | 'haiku' | 'all';
  version: string;
  author?: string;
  references?: string[];
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  sections: Map<string, string>;
  jsonSchema?: any;
}

export interface SkillDiscoveryResult {
  name: string;
  description: string;
  model: string;
  path: string;
}

// ============================================================================
// Cache
// ============================================================================

const skillCache = new Map<string, Skill>();
const metadataCache = new Map<string, SkillMetadata>();

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Discover all available skills in the skills directory
 * Returns only metadata (name + description) for Progressive Disclosure
 */
export function discoverSkills(): SkillDiscoveryResult[] {
  const skillsDir = __dirname;
  const results: SkillDiscoveryResult[] = [];
  
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        
        if (fs.existsSync(skillPath)) {
          const metadata = loadSkillMetadata(entry.name);
          if (metadata) {
            results.push({
              name: metadata.name,
              description: metadata.description,
              model: metadata.model,
              path: skillPath
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('[SkillLoader] Error discovering skills:', error);
  }
  
  console.log(`[SkillLoader] Discovered ${results.length} skills`);
  return results;
}

/**
 * Load only skill metadata (Progressive Disclosure - Level 1)
 */
export function loadSkillMetadata(skillName: string): SkillMetadata | null {
  if (metadataCache.has(skillName)) {
    return metadataCache.get(skillName)!;
  }
  
  const skillPath = path.join(__dirname, skillName, 'SKILL.md');
  
  if (!fs.existsSync(skillPath)) {
    console.warn(`[SkillLoader] Skill not found: ${skillName}`);
    return null;
  }
  
  const content = fs.readFileSync(skillPath, 'utf-8');
  const metadata = parseYamlFrontmatter(content);
  
  if (metadata) {
    metadataCache.set(skillName, metadata);
    console.log(`[SkillLoader] Loaded metadata for ${skillName}`);
  }
  
  return metadata;
}

/**
 * Load full skill content (Progressive Disclosure - Level 2)
 */
export function loadSkill(skillName: string): Skill | null {
  if (skillCache.has(skillName)) {
    return skillCache.get(skillName)!;
  }
  
  const skillPath = path.join(__dirname, skillName, 'SKILL.md');
  
  if (!fs.existsSync(skillPath)) {
    console.warn(`[SkillLoader] Skill not found: ${skillName}`);
    return null;
  }
  
  const rawContent = fs.readFileSync(skillPath, 'utf-8');
  const metadata = parseYamlFrontmatter(rawContent);
  
  if (!metadata) {
    console.error(`[SkillLoader] Invalid SKILL.md format: ${skillName}`);
    return null;
  }
  
  // Remove frontmatter from content
  const content = rawContent.replace(/^---[\s\S]*?---\n/, '').trim();
  
  // Parse sections
  const sections = parseSections(content);
  
  // Extract JSON Schema if present
  const jsonSchema = extractJsonSchema(content);
  
  const skill: Skill = {
    metadata,
    content,
    sections,
    jsonSchema
  };
  
  skillCache.set(skillName, skill);
  console.log(`[SkillLoader] Loaded skill: ${skillName} (${content.length} chars)`);
  
  return skill;
}

/**
 * Load specific sections from a skill (Progressive Disclosure - Level 3)
 */
export function loadSkillSections(skillName: string, sectionNames: string[]): string {
  const skill = loadSkill(skillName);
  if (!skill) return '';
  
  let result = '';
  
  for (const sectionName of sectionNames) {
    const section = skill.sections.get(sectionName);
    if (section) {
      result += section + '\n\n';
    }
  }
  
  return result.trim();
}

/**
 * Get key instructions for a skill (recommended sections)
 */
export function getKeyInstructions(skillName: string): string {
  const keySections = [
    '角色定義',
    '核心職責',
    '輸出格式',
    'JSON Schema'
  ];
  
  return loadSkillSections(skillName, keySections);
}

/**
 * Load skill with all referenced skills resolved
 */
export function loadSkillWithReferences(skillName: string): string {
  const skill = loadSkill(skillName);
  if (!skill) return '';
  
  let result = skill.content;
  
  // Load referenced skills
  if (skill.metadata.references && skill.metadata.references.length > 0) {
    result += '\n\n---\n\n## Referenced Skills\n\n';
    
    for (const refName of skill.metadata.references) {
      const refSkill = loadSkill(refName);
      if (refSkill) {
        result += `### ${refSkill.metadata.name}\n\n`;
        result += refSkill.content + '\n\n';
      }
    }
  }
  
  return result;
}

/**
 * Get JSON Schema for a skill
 */
export function getSkillJsonSchema(skillName: string): any {
  const skill = loadSkill(skillName);
  return skill?.jsonSchema || null;
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseYamlFrontmatter(content: string): SkillMetadata | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  const yaml = match[1];
  const metadata: Partial<SkillMetadata> = {};
  
  // Simple YAML parser (no external dependency)
  const lines = yaml.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();
    
    // Handle arrays
    if (key === 'references') {
      const refs: string[] = [];
      // Check if it's inline array
      if (value.startsWith('[')) {
        value = value.slice(1, -1);
        refs.push(...value.split(',').map(s => s.trim()));
      }
      metadata.references = refs;
    } else {
      (metadata as any)[key] = value;
    }
  }
  
  // Validate required fields
  if (!metadata.name || !metadata.description || !metadata.model || !metadata.version) {
    return null;
  }
  
  return metadata as SkillMetadata;
}

function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  
  let currentSection = '';
  let currentContent: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Save previous section
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      
      // Start new section
      currentSection = line.substring(3).trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  // Save last section
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }
  
  return sections;
}

function extractJsonSchema(content: string): any {
  const schemaStart = content.indexOf('## JSON Schema');
  if (schemaStart === -1) return null;
  
  const codeBlockStart = content.indexOf('```json', schemaStart);
  if (codeBlockStart === -1) return null;
  
  const codeBlockEnd = content.indexOf('```', codeBlockStart + 7);
  if (codeBlockEnd === -1) return null;
  
  const jsonString = content.substring(codeBlockStart + 7, codeBlockEnd).trim();
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('[SkillLoader] Failed to parse JSON Schema:', error);
    return null;
  }
}

// ============================================================================
// Cache Management
// ============================================================================

export function clearCache(): void {
  skillCache.clear();
  metadataCache.clear();
  console.log('[SkillLoader] Cache cleared');
}

export function getCacheStats(): { skills: number; metadata: number } {
  return {
    skills: skillCache.size,
    metadata: metadataCache.size
  };
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

// Re-export for backward compatibility with existing agents
export { loadSkill as loadSkillLegacy };

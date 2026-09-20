/**
 * 构思画布文档校验（docs/idea-canvas-plan.md §6.3）。
 *
 * 客户端与服务器共用同一契约：/api/canvases 与 mock api-shim 都用它校验
 * content。对未来未知块类型不静默删除——保留原数据、报告 unknownBlockIds，
 * 由 UI 渲染占位并阻止不兼容保存（规格 §6.1）。
 */

import {
  BOARD_MAX_WIDTH,
  BOARD_MIN_WIDTH,
  CANVAS_SCHEMA_VERSION,
  CanvasDoc,
  countNodes,
} from "./model";

export const CANVAS_LIMITS = {
  maxBoards: 50,
  maxSectionsPerBoard: 200,
  maxColumnsPerSection: 6,
  maxBlocksPerColumn: 20,
  maxBlocks: 400,
  maxFreeItems: 100,
  maxTextLength: 5000,
  maxTitleLength: 200,
  maxAssetUrlLength: 2048,
  maxDimension: 100000,
} as const;

export interface CanvasValidationOptions {
  /** mock 模式允许 mock-image: 前缀（本机 IndexedDB 资源）；真实服务器一律拒绝。 */
  allowMockImages?: boolean;
}

export interface CanvasValidationResult {
  ok: boolean;
  errors: string[];
  /** 未知块类型（未来版本数据）：已保留在 doc 中，展示占位并禁止保存。 */
  unknownBlockIds: string[];
  doc: CanvasDoc | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function validateStyle(style: unknown, errors: string[], path: string): void {
  if (style === undefined || style === null) return;
  if (typeof style !== "object" || Array.isArray(style)) {
    errors.push(`${path}.style 必须是对象`);
    return;
  }
  const s = style as Record<string, unknown>;
  if (s.fontSize !== undefined && !["sm", "md", "lg", "xl"].includes(String(s.fontSize))) {
    errors.push(`${path}.style.fontSize 非法`);
  }
  if (s.bold !== undefined && typeof s.bold !== "boolean") {
    errors.push(`${path}.style.bold 非法`);
  }
  for (const key of ["color", "background"] as const) {
    const v = s[key];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 32)) {
      errors.push(`${path}.style.${key} 非法`);
    }
  }
  if (s.align !== undefined && !["left", "center", "right"].includes(String(s.align))) {
    errors.push(`${path}.style.align 非法`);
  }
  if (
    s.radius !== undefined &&
    s.radius !== null &&
    (!isFiniteNumber(s.radius) || s.radius < 0 || s.radius > 64)
  ) {
    errors.push(`${path}.style.radius 非法`);
  }
}

function validateBlock(
  block: unknown,
  errors: string[],
  unknownBlockIds: string[],
  options: CanvasValidationOptions,
  path: string,
): boolean {
  if (typeof block !== "object" || block === null) {
    errors.push(`${path} 必须是对象`);
    return false;
  }
  const b = block as Record<string, unknown>;
  if (!isId(b.id)) {
    errors.push(`${path}.id 非法`);
    return false;
  }
  if (b.type === "text") {
    if (typeof b.text !== "string" || b.text.length > CANVAS_LIMITS.maxTextLength) {
      errors.push(`${path}.text 超长或非法`);
    }
    if (b.role !== "title" && b.role !== "body") {
      errors.push(`${path}.role 非法`);
    }
    validateStyle(b.style, errors, path);
    return true;
  }
  if (b.type === "image") {
    if (b.asset !== null && b.asset !== undefined) {
      if (typeof b.asset !== "object") {
        errors.push(`${path}.asset 非法`);
        return true;
      }
      const a = b.asset as Record<string, unknown>;
      const status = typeof a.uploadStatus === "string" ? a.uploadStatus : "saved";
      if (typeof a.url !== "string" || a.url.length > CANVAS_LIMITS.maxAssetUrlLength) {
        errors.push(`${path}.asset.url 非法`);
      } else if (a.url === "") {
        // pending/failed 占位允许空 url；saved 状态必须有持久地址
        if (status === "saved" || status === undefined) {
          errors.push(`${path}.asset.url 已保存资产不允许为空`);
        }
      } else {
        const persistable =
          /^https?:\/\//.test(a.url) || a.url.startsWith("/storage/");
        const mockOk = options.allowMockImages === true && a.url.startsWith("mock-image:");
        if (!persistable && !mockOk) {
          errors.push(`${path}.asset.url 不是可持久化资源（禁止 blob:/data: 等短期地址）`);
        }
      }
      if (a.localKey !== undefined && (typeof a.localKey !== "string" || a.localKey.length > 128)) {
        errors.push(`${path}.asset.localKey 非法`);
      }
      if (!isFiniteNumber(a.naturalWidth) || a.naturalWidth <= 0 || a.naturalWidth > CANVAS_LIMITS.maxDimension) {
        errors.push(`${path}.asset.naturalWidth 非法`);
      }
      if (!isFiniteNumber(a.naturalHeight) || a.naturalHeight <= 0 || a.naturalHeight > CANVAS_LIMITS.maxDimension) {
        errors.push(`${path}.asset.naturalHeight 非法`);
      }
      if (a.uploadStatus !== undefined && !["saved", "pending", "failed"].includes(String(a.uploadStatus))) {
        errors.push(`${path}.asset.uploadStatus 非法`);
      }
    }
    if (b.fit !== "contain" && b.fit !== "cover") {
      errors.push(`${path}.fit 非法`);
    }
    validateStyle(b.style, errors, path);
    return true;
  }
  // 未知类型：保留原数据，报告占位，禁止保存。
  unknownBlockIds.push(String(b.id));
  return true;
}

/**
 * 校验并解析画布 content JSON。结构非法时 ok=false 且 doc=null；
 * 存在未知块时 ok=false 但 doc 保留原数据（供占位渲染）。
 */
export function validateCanvasContent(
  raw: unknown,
  options: CanvasValidationOptions = {},
): CanvasValidationResult {
  const errors: string[] = [];
  const unknownBlockIds: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["content 必须是对象"], unknownBlockIds, doc: null };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`schemaVersion 必须是 ${CANVAS_SCHEMA_VERSION}`],
      unknownBlockIds,
      doc: null,
    };
  }
  const doc = obj as unknown as CanvasDoc;
  if (!Array.isArray(doc.boards) || !Array.isArray(doc.freeItems)) {
    return { ok: false, errors: ["boards/freeItems 必须是数组"], unknownBlockIds, doc: null };
  }
  if (doc.boards.length > CANVAS_LIMITS.maxBoards) {
    errors.push(`版面数超过上限 ${CANVAS_LIMITS.maxBoards}`);
  }
  if (doc.freeItems.length > CANVAS_LIMITS.maxFreeItems) {
    errors.push(`自由容器数超过上限 ${CANVAS_LIMITS.maxFreeItems}`);
  }
  const seenIds = new Set<string>();
  const markId = (id: string, path: string) => {
    if (seenIds.has(id)) errors.push(`${path} 重复 ID: ${id}`);
    seenIds.add(id);
  };

  doc.boards.forEach((board, bi) => {
    const path = `boards[${bi}]`;
    if (typeof board !== "object" || board === null) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    if (!isId(board.id)) errors.push(`${path}.id 非法`);
    else markId(board.id, path);
    if (!isFiniteNumber(board.x) || Math.abs(board.x) > 1e6) errors.push(`${path}.x 非法`);
    if (!isFiniteNumber(board.y) || Math.abs(board.y) > 1e6) errors.push(`${path}.y 非法`);
    if (
      !isFiniteNumber(board.width) ||
      board.width < BOARD_MIN_WIDTH ||
      board.width > BOARD_MAX_WIDTH
    ) {
      errors.push(`${path}.width 超出范围`);
    }
    if (!isFiniteNumber(board.padding) || board.padding < 0 || board.padding > 128) {
      errors.push(`${path}.padding 非法`);
    }
    if (!isFiniteNumber(board.gap) || board.gap < 0 || board.gap > 128) {
      errors.push(`${path}.gap 非法`);
    }
    if (!Array.isArray(board.sections)) {
      errors.push(`${path}.sections 必须是数组`);
      return;
    }
    if (board.sections.length > CANVAS_LIMITS.maxSectionsPerBoard) {
      errors.push(`${path}.sections 超过上限`);
    }
    board.sections.forEach((section, si) => {
      const spath = `${path}.sections[${si}]`;
      if (typeof section !== "object" || section === null) {
        errors.push(`${spath} 必须是对象`);
        return;
      }
      if (!isId(section.id)) errors.push(`${spath}.id 非法`);
      else markId(section.id, spath);
      if (!["equal", "manual", "smart"].includes(String(section.widthMode))) {
        errors.push(`${spath}.widthMode 非法`);
      }
      if (!Array.isArray(section.columns)) {
        errors.push(`${spath}.columns 必须是数组`);
        return;
      }
      if (section.columns.length > CANVAS_LIMITS.maxColumnsPerSection) {
        errors.push(`${spath}.columns 超过上限 ${CANVAS_LIMITS.maxColumnsPerSection}`);
      }
      if (!Array.isArray(section.columnWeights)) {
        errors.push(`${spath}.columnWeights 必须是数组`);
      } else {
        if (section.columnWeights.length !== section.columns.length) {
          errors.push(`${spath}.columnWeights 长度与列数不一致`);
        }
        for (const w of section.columnWeights) {
          if (!isFiniteNumber(w) || w <= 0) {
            errors.push(`${spath}.columnWeights 必须为正有限数`);
            break;
          }
        }
      }
      section.columns.forEach((column, ci) => {
        const cpath = `${spath}.columns[${ci}]`;
        if (typeof column !== "object" || column === null) {
          errors.push(`${cpath} 必须是对象`);
          return;
        }
        if (!isId(column.id)) errors.push(`${cpath}.id 非法`);
        else markId(column.id, cpath);
        if (!Array.isArray(column.blocks)) {
          errors.push(`${cpath}.blocks 必须是数组`);
          return;
        }
        if (column.blocks.length > CANVAS_LIMITS.maxBlocksPerColumn) {
          errors.push(`${cpath}.blocks 超过上限`);
        }
        column.blocks.forEach((block, ki) => {
          validateBlock(block, errors, unknownBlockIds, options, `${cpath}.blocks[${ki}]`);
          if (typeof block === "object" && block !== null && isId((block as { id?: unknown }).id)) {
            markId((block as { id: string }).id, `${cpath}.blocks[${ki}]`);
          }
        });
      });
    });
  });

  doc.freeItems.forEach((item, fi) => {
    const path = `freeItems[${fi}]`;
    if (typeof item !== "object" || item === null) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    if (!isId(item.id)) errors.push(`${path}.id 非法`);
    else markId(item.id, path);
    if (!isFiniteNumber(item.x) || Math.abs(item.x) > 1e6) errors.push(`${path}.x 非法`);
    if (!isFiniteNumber(item.y) || Math.abs(item.y) > 1e6) errors.push(`${path}.y 非法`);
    if (!isFiniteNumber(item.width) || item.width < 40 || item.width > 2000) {
      errors.push(`${path}.width 非法`);
    }
    if (!Number.isInteger(item.zIndex) || item.zIndex < 0 || item.zIndex > 10000) {
      errors.push(`${path}.zIndex 非法`);
    }
    validateBlock(item.block, errors, unknownBlockIds, options, `${path}.block`);
    if (
      typeof item.block === "object" &&
      item.block !== null &&
      isId((item.block as { id?: unknown }).id)
    ) {
      markId((item.block as { id: string }).id, `${path}.block`);
    }
  });

  const stats = countNodes(doc);
  if (stats.blocks > CANVAS_LIMITS.maxBlocks) {
    errors.push(`模块总数超过上限 ${CANVAS_LIMITS.maxBlocks}`);
  }

  return {
    ok: errors.length === 0 && unknownBlockIds.length === 0,
    errors,
    unknownBlockIds,
    doc: errors.length === 0 ? doc : doc,
  };
}

/** 文档结构是否可保存（客户端保存闸门：未知块存在时禁止自动写回）。 */
export function isDocSavable(result: CanvasValidationResult): boolean {
  return result.errors.length === 0 && result.unknownBlockIds.length === 0;
}

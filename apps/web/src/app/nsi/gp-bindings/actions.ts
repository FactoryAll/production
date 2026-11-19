'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma, writeAudit } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requirePermission } from '@/lib/auth/access';
import { bindingQuantity } from '@/lib/gp-mass-binding';

/**
 * Привязки изделия: правка Массы, Тубы и РЦ фасовки (решение владельца 19.11.2026).
 *
 * Почему отдельное действие, а не «как-нибудь через импорт»: привязка приходит из 1С, но её
 * приходится и править руками — 13 ГП в выгрузке отсутствуют, часть позиций может быть
 * устаревшей. Ручная правка обязана быть такой же прослеживаемой, как загрузка: право,
 * проверка на сервере, запись «было → стало» в аудит.
 */

export interface SaveBindingResult {
  success: boolean;
  error?: string;
}

export interface SaveBindingInput {
  productId: string;
  /** Код Массы или пустая строка — снять привязку. */
  massCode: string;
  massQuantity: string;
  /** Код и наименование Тубы: номенклатуры Туб пока нет, храним как в 1С. */
  tubeCode: string;
  tubeName: string;
  tubeQuantity: string;
  /** Коды РЦ фасовки; пустой список — «все фасовочные РЦ». */
  packagingWorkCenterCodes: string[];
}

export interface SaveBindingDeps {
  prisma: typeof prisma;
  writeAudit: typeof writeAudit;
  requirePermission: typeof requirePermission;
}

export async function saveProductBinding(
  input: SaveBindingInput,
  deps: SaveBindingDeps = { prisma, writeAudit, requirePermission },
): Promise<void> {
  const session = await deps.requirePermission('nsi:manage');
  const userId = session.userId;
  const roles = session.user.roles.map((ur) => ur.role.code);

  // Требование владельца: сводная и правка — для НП и АДМ. Право `nsi:manage` есть и у НП,
  // и у АДМ; дополнительно проверяем явно, чтобы не поймать расширение прав из старого сида.
  if (!hasPermission(roles, 'nsi:manage')) {
    throw new Error('Forbidden: insufficient permissions');
  }

  const product = await deps.prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      massProductId: true,
      massQuantity: true,
      tubeProductCode: true,
      tubeProductName: true,
      tubeQuantity: true,
      packagingWorkCenters: { select: { workCenter: { select: { code: true } } } },
    },
  });
  if (!product) {
    throw new Error('Номенклатура не найдена');
  }
  if (product.category !== 'GP') {
    throw new Error('Привязки задаются только готовой продукции');
  }

  const massQuantity = bindingQuantity(input.massQuantity);
  const tubeQuantity = bindingQuantity(input.tubeQuantity);
  const massCode = input.massCode.trim();

  let massProductId: string | null = null;
  if (massCode !== '') {
    const mass = await deps.prisma.product.findUnique({
      where: { code: massCode },
      select: { id: true, category: true, active: true },
    });
    if (!mass) {
      throw new Error(`Массы ${massCode} нет в номенклатуре`);
    }
    if (mass.category !== 'MASS') {
      throw new Error(`Код ${massCode} — не Масса, а ${mass.category}`);
    }
    if (!mass.active) {
      throw new Error(`Масса ${massCode} деактивирована`);
    }
    massProductId = mass.id;
  }

  // Норма без привязки смысла не имеет: иначе в потреблении появится «норма есть, а списывать нечего».
  if (massProductId === null && massQuantity !== null) {
    throw new Error('Норма Массы задаётся вместе с привязкой');
  }
  if (input.tubeCode.trim() === '' && tubeQuantity !== null) {
    throw new Error('Норма Тубы задаётся вместе с Тубой');
  }

  const workCenters = input.packagingWorkCenterCodes.filter((code) => code.trim() !== '');
  if (workCenters.length > 0) {
    const found = await deps.prisma.workCenter.findMany({
      where: { code: { in: workCenters } },
      select: { code: true, producesMass: true },
    });
    if (found.length !== workCenters.length) {
      throw new Error('Часть РЦ фасовки не найдена в справочнике');
    }
    const massLine = found.find((workCenter) => workCenter.producesMass);
    if (massLine) {
      throw new Error(
        `РЦ ${massLine.code} производит Массу и не фасует готовую продукцию — уберите его из списка`,
      );
    }
  }

  const before = {
    massProductCode: product.massProductId ? 'задана' : null,
    massQuantity: product.massQuantity?.toString() ?? null,
    tubeProductCode: product.tubeProductCode,
    tubeQuantity: product.tubeQuantity?.toString() ?? null,
    packagingWorkCenterCodes: product.packagingWorkCenters
      .map((item) => item.workCenter.code)
      .sort(),
  };
  const after = {
    massProductCode: massCode || null,
    massQuantity: massQuantity === null ? null : String(massQuantity),
    tubeProductCode: input.tubeCode.trim() || null,
    tubeQuantity: tubeQuantity === null ? null : String(tubeQuantity),
    packagingWorkCenterCodes: [...workCenters].sort(),
  };

  await deps.prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        massProductId,
        massQuantity: massQuantity === null ? null : new Prisma.Decimal(massQuantity),
        tubeProductCode: input.tubeCode.trim() || null,
        tubeProductName: input.tubeName.trim() || null,
        tubeQuantity: tubeQuantity === null ? null : new Prisma.Decimal(tubeQuantity),
        packagingWorkCenters: {
          deleteMany: {},
          create: workCenters.map((code) => ({
            workCenter: { connect: { code } },
          })),
        },
      },
    });

    await deps.writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'Product',
      objectId: product.id,
      field: 'bindings',
      oldValue: JSON.stringify(before),
      newValue: JSON.stringify(after),
      userId,
      userRoles: roles,
      permission: 'nsi:manage',
    });
  });

  revalidatePath('/nsi/gp-bindings');
  revalidatePath('/production-orders/new');
}

/** Обёртка для формы: ошибка — текстом, а не «Application error». */
export async function saveProductBindingAction(formData: FormData): Promise<SaveBindingResult> {
  try {
    await saveProductBinding({
      productId: formData.get('productId')?.toString() ?? '',
      massCode: formData.get('massCode')?.toString() ?? '',
      massQuantity: formData.get('massQuantity')?.toString() ?? '',
      tubeCode: formData.get('tubeCode')?.toString() ?? '',
      tubeName: formData.get('tubeName')?.toString() ?? '',
      tubeQuantity: formData.get('tubeQuantity')?.toString() ?? '',
      packagingWorkCenterCodes: JSON.parse(formData.get('packagingWorkCenterCodes')?.toString() || '[]'),
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось сохранить привязку',
    };
  }
}

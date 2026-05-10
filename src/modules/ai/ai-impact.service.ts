import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AnyDiffItem,
  SystemDefinitionDiff,
} from '../../shared/system-definition';
import { EntityDefinitionEntity } from '../systems/entities/entity-definition.entity';
import { ModuleDefinitionEntity } from '../systems/entities/module-definition.entity';
import { SystemEntity } from '../systems/entities/system.entity';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { WorkflowDefinitionEntity } from '../workflows/entities/workflow-definition.entity';

export interface DiffItemImpact {
  changeId: string;
  recordsAffected: number;
  workflowsAffected: number;
  notes: string[];
}

export interface DiffImpactReport {
  totals: {
    recordsAffected: number;
    workflowsAffected: number;
    destructiveChanges: number;
  };
  items: Record<string, DiffItemImpact>;
}

@Injectable()
export class AiImpactService {
  constructor(
    @InjectRepository(SystemEntity)
    private readonly systemsRepository: Repository<SystemEntity>,
    @InjectRepository(ModuleDefinitionEntity)
    private readonly modulesRepository: Repository<ModuleDefinitionEntity>,
    @InjectRepository(EntityDefinitionEntity)
    private readonly entitiesRepository: Repository<EntityDefinitionEntity>,
    @InjectRepository(RuntimeRecordEntity)
    private readonly recordsRepository: Repository<RuntimeRecordEntity>,
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly workflowsRepository: Repository<WorkflowDefinitionEntity>,
  ) {}

  async computeImpact(
    systemId: string | null,
    diff: SystemDefinitionDiff,
  ): Promise<DiffImpactReport> {
    const items: Record<string, DiffItemImpact> = {};
    const totals = {
      recordsAffected: 0,
      workflowsAffected: 0,
      destructiveChanges: 0,
    };

    const init = (item: AnyDiffItem): DiffItemImpact => {
      const entry: DiffItemImpact = {
        changeId: item.id,
        recordsAffected: 0,
        workflowsAffected: 0,
        notes: [],
      };
      items[item.id] = entry;
      return entry;
    };

    // For create_system requests there is no live system yet — every change is
    // additive against an empty state, so impact is zero.
    if (!systemId) {
      const all: AnyDiffItem[] = [
        ...diff.modules,
        ...diff.entities,
        ...diff.fields,
        ...diff.workflows,
        ...diff.permissions,
      ];
      for (const item of all) {
        const entry = init(item);
        if (item.op === 'add') {
          entry.notes.push('New — no existing data affected.');
        }
      }
      return { totals, items };
    }

    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system) {
      throw new NotFoundException('System not found.');
    }
    const versionId = system.publishedVersionId;

    const moduleRows = versionId
      ? await this.modulesRepository.find({
          where: { systemId, systemVersionId: versionId },
        })
      : [];
    const entityRows = versionId
      ? await this.entitiesRepository.find({
          where: { systemId, systemVersionId: versionId },
        })
      : [];

    const moduleIdByKey = new Map(moduleRows.map((m) => [m.key, m.id]));
    const entityIdByModuleEntityKey = new Map(
      entityRows.map((e) => {
        const moduleKey = moduleRows.find(
          (m) => m.id === e.moduleDefinitionId,
        )?.key;
        return [`${moduleKey ?? ''}::${e.key}`, e.id];
      }),
    );

    // Modules
    for (const m of diff.modules) {
      const entry = init(m);
      if (m.op !== 'remove') {
        if (m.op === 'add') entry.notes.push('New module — no existing data.');
        continue;
      }
      const moduleId = moduleIdByKey.get(m.moduleKey);
      if (!moduleId) {
        entry.notes.push('Module not present in published version.');
        continue;
      }
      const recordCount = await this.recordsRepository.count({
        where: { systemId, moduleDefinitionId: moduleId },
      });
      const workflowCount = await this.workflowsRepository.count({
        where: { systemId, moduleDefinitionId: moduleId },
      });
      entry.recordsAffected = recordCount;
      entry.workflowsAffected = workflowCount;
      if (recordCount + workflowCount > 0) totals.destructiveChanges += 1;
      if (recordCount > 0)
        entry.notes.push(`${recordCount} record(s) will be deleted.`);
      if (workflowCount > 0)
        entry.notes.push(`${workflowCount} workflow(s) will be detached.`);
      totals.recordsAffected += recordCount;
      totals.workflowsAffected += workflowCount;
    }

    // Entities
    for (const e of diff.entities) {
      const entry = init(e);
      if (e.op !== 'remove') {
        if (e.op === 'add') entry.notes.push('New entity — no existing data.');
        continue;
      }
      const entityId = entityIdByModuleEntityKey.get(
        `${e.moduleKey}::${e.entityKey}`,
      );
      if (!entityId) {
        entry.notes.push('Entity not present in published version.');
        continue;
      }
      const recordCount = await this.recordsRepository.count({
        where: { systemId, entityDefinitionId: entityId },
      });
      entry.recordsAffected = recordCount;
      if (recordCount > 0) {
        totals.destructiveChanges += 1;
        entry.notes.push(`${recordCount} record(s) will be deleted.`);
      }
      totals.recordsAffected += recordCount;
    }

    // Fields
    for (const f of diff.fields) {
      const entry = init(f);
      const entityId = entityIdByModuleEntityKey.get(
        `${f.moduleKey}::${f.entityKey}`,
      );

      if (f.op === 'add') {
        if (!entityId) {
          entry.notes.push('New field on a new entity.');
          continue;
        }
        const total = await this.recordsRepository.count({
          where: { systemId, entityDefinitionId: entityId },
        });
        if (f.after?.required && !f.after.config?.defaultValue && total > 0) {
          entry.recordsAffected = total;
          totals.recordsAffected += total;
          totals.destructiveChanges += 1;
          entry.notes.push(
            `${total} existing record(s) will be missing this required field.`,
          );
        } else if (total > 0) {
          entry.notes.push(`${total} record(s) will get this new optional field.`);
        }
        continue;
      }

      if (!entityId) {
        entry.notes.push('Entity not in published version.');
        continue;
      }

      // Count records that have a value for this field.
      const populated = await this.recordsRepository
        .createQueryBuilder('r')
        .where('r.system_id = :systemId', { systemId })
        .andWhere('r.entity_definition_id = :entityId', { entityId })
        .andWhere(`r.data ? :fieldKey`, { fieldKey: f.fieldKey })
        .getCount();

      if (f.op === 'remove') {
        entry.recordsAffected = populated;
        if (populated > 0) {
          totals.recordsAffected += populated;
          totals.destructiveChanges += 1;
          entry.notes.push(
            `${populated} record(s) hold a value for "${f.fieldKey}" and will lose it.`,
          );
        } else {
          entry.notes.push('No records hold a value for this field.');
        }
      } else if (f.op === 'modify') {
        const typeChanged =
          !!f.before && !!f.after && f.before.dataType !== f.after.dataType;
        if (typeChanged && populated > 0) {
          entry.recordsAffected = populated;
          totals.recordsAffected += populated;
          totals.destructiveChanges += 1;
          entry.notes.push(
            `${populated} record(s) need migration from ${f.before?.dataType} → ${f.after?.dataType}.`,
          );
        } else if (
          !!f.before &&
          !!f.after &&
          !f.before.required &&
          f.after.required &&
          populated < (await this.recordsRepository.count({
            where: { systemId, entityDefinitionId: entityId },
          }))
        ) {
          const totalRecords = await this.recordsRepository.count({
            where: { systemId, entityDefinitionId: entityId },
          });
          const missing = totalRecords - populated;
          entry.recordsAffected = missing;
          totals.recordsAffected += missing;
          totals.destructiveChanges += 1;
          entry.notes.push(
            `${missing} record(s) currently have no value and will violate required.`,
          );
        }
      }
    }

    // Workflows: removing a workflow definition has downstream impact only
    // if there's a stored definition matching by key.
    for (const w of diff.workflows) {
      const entry = init(w);
      if (w.op !== 'remove') continue;
      const found = await this.workflowsRepository.count({
        where: { systemId, key: w.key },
      });
      entry.workflowsAffected = found;
      if (found > 0) {
        totals.workflowsAffected += found;
        totals.destructiveChanges += 1;
        entry.notes.push(`Active workflow definition "${w.key}" will be removed.`);
      }
    }

    // Permissions: surface whether any policy rows exist for the identity.
    for (const p of diff.permissions) {
      init(p);
      // No row count exposed for permission policies here — score already
      // captures the risk; the UI shows the diff explanation.
    }

    return { totals, items };
  }
}

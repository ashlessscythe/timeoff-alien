import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moment = require('moment')
const { wrapSchedule } = require('../../lib/model/sessionUser.js')

const defaultDays = {
  monday: 1,
  tuesday: 1,
  wednesday: 1,
  thursday: 1,
  friday: 1,
  saturday: 2,
  sunday: 2
}

function makePrisma() {
  return {
    schedules: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }
}

describe('wrapSchedule', () => {
  it('is_user_specific is true when user_id is set', () => {
    const s = wrapSchedule({ ...defaultDays, user_id: 42, id: 1 }, makePrisma())
    expect(s.is_user_specific()).toBe(true)
  })

  it('is_user_specific is false when user_id is absent', () => {
    const s = wrapSchedule({ ...defaultDays, company_id: 1, id: 1 }, makePrisma())
    expect(s.is_user_specific()).toBe(false)
  })

  it('is_it_working_day respects weekday flags (UTC)', () => {
    const s = wrapSchedule(
      {
        ...defaultDays,
        monday: 2,
        tuesday: 1,
        id: 1
      },
      makePrisma()
    )
    const mon = moment.utc('2026-06-01', 'YYYY-MM-DD')
    const tue = moment.utc('2026-06-02', 'YYYY-MM-DD')
    expect(s.is_it_working_day({ day: mon })).toBe(false)
    expect(s.is_it_working_day({ day: tue })).toBe(true)
  })

  it('save is a no-op without id and without user_id/company_id', async () => {
    const prisma = makePrisma()
    const s = wrapSchedule(null, prisma)
    await s.save()
    expect(prisma.schedules.create).not.toHaveBeenCalled()
    expect(prisma.schedules.update).not.toHaveBeenCalled()
  })

  it('save inserts when there is no id but user_id is set', async () => {
    const prisma = makePrisma()
    prisma.schedules.create.mockImplementation(async ({ data }) => ({
      id: 501,
      ...data
    }))
    const s = wrapSchedule(
      {
        ...defaultDays,
        user_id: 77,
        company_id: null
      },
      prisma
    )
    s.set('monday', 'off')
    s.set('saturday', 'on')
    await s.save()
    expect(prisma.schedules.create).toHaveBeenCalledTimes(1)
    const arg = prisma.schedules.create.mock.calls[0][0]
    expect(arg.data.user_id).toBe(77)
    expect(arg.data.company_id).toBeNull()
    expect(arg.data.monday).toBe(2)
    expect(arg.data.saturday).toBe(1)
    expect(s.id).toBe(501)
    expect(s.monday).toBe(2)
  })

  it('save updates when id is present', async () => {
    const prisma = makePrisma()
    prisma.schedules.update.mockResolvedValue({
      id: 12,
      user_id: 5,
      ...defaultDays,
      friday: 2,
      created_at: new Date(),
      updated_at: new Date()
    })
    const s = wrapSchedule(
      {
        id: 12,
        user_id: 5,
        company_id: null,
        ...defaultDays
      },
      prisma
    )
    s.set('friday', 'off')
    await s.save()
    expect(prisma.schedules.create).not.toHaveBeenCalled()
    expect(prisma.schedules.update).toHaveBeenCalledTimes(1)
    const arg = prisma.schedules.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 12 })
    expect(arg.data.friday).toBe(2)
    expect(s.friday).toBe(2)
  })

  it('destroy deletes by id and clears user_id on the instance', async () => {
    const prisma = makePrisma()
    prisma.schedules.delete.mockResolvedValue({})
    const s = wrapSchedule(
      {
        id: 33,
        user_id: 9,
        company_id: null,
        ...defaultDays
      },
      prisma
    )
    await s.destroy()
    expect(prisma.schedules.delete).toHaveBeenCalledWith({ where: { id: 33 } })
    expect(s.id).toBeUndefined()
    expect(s.user_id).toBeNull()
  })

  it('destroy without id does not call prisma', async () => {
    const prisma = makePrisma()
    const s = wrapSchedule(
      { user_id: 1, company_id: null, ...defaultDays },
      prisma
    )
    await s.destroy()
    expect(prisma.schedules.delete).not.toHaveBeenCalled()
  })
})

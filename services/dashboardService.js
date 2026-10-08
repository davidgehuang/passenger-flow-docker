'use strict';

// Dashboard 聚合服务：统计卡片 + 6 类图表数据

const flowEventModel = require('../models/flowEventModel');
const deviceModel = require('../models/deviceModel');
const storeModel = require('../models/storeModel');
const statsModel = require('../models/statsModel');

async function getSummary() {
  const [today, peakHour, busiest, deviceCounts, storeCounts, dbVersion] = await Promise.all([
    flowEventModel.todayStats(),
    flowEventModel.peakHourToday(),
    flowEventModel.busiestStoreToday(),
    deviceModel.statusCounts(),
    storeModel.countByStatus(),
    statsModel.mysqlVersion().catch(() => null),
  ]);

  const totalStores = Object.values(storeCounts).reduce((s, v) => s + Number(v), 0);

  return {
    todayTotalPeople: today.totalPeople,
    todayInPeople: today.inPeople,
    todayOutPeople: today.outPeople,
    currentInStore: today.inStore,
    totalStores,
    onlineDevices: deviceCounts.ONLINE || 0,
    offlineDevices: deviceCounts.OFFLINE || 0,
    busiestStore: busiest ? busiest.store_name : '-',
    busiestStorePeople: busiest ? Number(busiest.people) : 0,
    peakHour,
    database: {
      status: dbVersion ? 'UP' : 'DOWN',
      version: dbVersion,

    },
  };
}

async function getCharts() {
  const [trend24h, trend7d, top10, inOut, city, deviceCounts] = await Promise.all([
    flowEventModel.hourlyTrend24h(),
    flowEventModel.dailyTrend7d(),
    flowEventModel.topStores(10),
    flowEventModel.inOutTrend7d(),
    flowEventModel.cityCompare7d(),
    deviceModel.statusCounts(),
  ]);

  return {
    trend24h: {
      labels: trend24h.map((r) => r.label),
      data: trend24h.map((r) => Number(r.people)),
    },
    trend7d: {
      labels: trend7d.map((r) => r.label),
      data: trend7d.map((r) => Number(r.people)),
    },
    top10: {
      labels: top10.map((r) => r.label),
      data: top10.map((r) => Number(r.people)),
    },
    inOut: {
      labels: inOut.map((r) => r.label),
      inData: inOut.map((r) => Number(r.in_people)),
      outData: inOut.map((r) => Number(r.out_people)),
    },
    city: {
      labels: city.map((r) => r.label),
      data: city.map((r) => Number(r.people)),
    },
    deviceStatus: {
      labels: ['在线', '离线', '告警', '维护中'],
      data: [
        deviceCounts.ONLINE || 0,
        deviceCounts.OFFLINE || 0,
        deviceCounts.WARNING || 0,
        deviceCounts.MAINTENANCE || 0,
      ],
    },
  };
}

module.exports = { getSummary, getCharts };

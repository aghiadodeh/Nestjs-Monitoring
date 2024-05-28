import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model, PipelineStage } from "mongoose";
import { RequestLog } from "../../entities/request-log.entity";
import { MongooseLog } from "../../entities/mongoose-log.entity";
import { MonitoringListResponse } from "../../../../models/list.response";
import { JobLog } from "../../entities/job-log.entity";
import { MonitoringService } from "../../../shared/monitoring/services/monitoring.service";
import { MonitoringBaseFilterDto } from "../../../shared/monitoring/dtos/base-filter.dto";
import { MonitoringRequestFilterDto } from "../../../shared/monitoring/dtos/monitoring-requests-filter.dto";
import { MonitoringMongoFilterDto } from "../../../shared/monitoring/dtos/monitoring-mongo-filter.dto";
import { MonitoringJobFilterDto } from "../../../shared/monitoring/dtos/jobs-filter.dto";
import { MONITORING_MONGO_CONNECTION } from "../../../shared/config/config";

@Injectable()
export class MongooseAnalyzeService extends MonitoringService {
  private get durationProjection(): PipelineStage.Project {
    return { $project: { duration: 1, url: 1, method: 1, success: 1, 'response.statusCode': 1 } };
  }

  private durationBoundaries = [0, 20, 40, 80, 130, 150, 180, 200, 500, 1000, 2000];

  private get durationBucket(): PipelineStage.Bucket {
    return {
      $bucket: {
        groupBy: "$duration",
        boundaries: this.durationBoundaries,
        default: 1000000,
        output: {
          count: { $sum: 1 },
          data: {
            $push: {
              duration: "$duration",
              method: "$method",
              url: "$url",
              success: "$success",
              statusCode: "$response.statusCode",
            },
          },
        },
      },
    };
  }

  constructor(
    @InjectModel(JobLog.name, MONITORING_MONGO_CONNECTION) private jobLog: Model<JobLog>,
    @InjectModel(RequestLog.name, MONITORING_MONGO_CONNECTION)
    private requestLog: Model<RequestLog>,
    @InjectModel(MongooseLog.name, MONITORING_MONGO_CONNECTION)
    private mongooseLog: Model<MongooseLog>,
  ) {
    super();
  }

  public async findAllRequests(
    filterDto: MonitoringRequestFilterDto,
  ): Promise<MonitoringListResponse<RequestLog>> {
    const { fromDate, toDate } = this.getFilterDates(filterDto);
    const condition = { createdAt: { $gte: fromDate, $lt: toDate } };
    const { sortDir, exception, url, method, success, user } = filterDto;
    if (exception) {
      condition["response.exception"] = { $exists: true };
    }
    if (url) {
      condition["url"] = { $regex: url, $options: "i" };
    }
    if (method) {
      condition["method"] = { $in: method.split(",") };
    }
    if (success) {
      condition["success"] = JSON.parse(success);
    }
    if (user && mongoose.isValidObjectId(user)) {
      condition["request.user._id"] = new mongoose.Types.ObjectId(user);
    }
    const { perPage, skip } = this.getPaginationData(filterDto);
    const sortKey = filterDto.sortKey ?? "createdAt";

    const data = await this.requestLog
      .find(condition)
      .select({
        __v: 0,
        updatedAt: 0,
        "response.data": 0,
        "response.success": 0,
        "request.method": 0,
        "request.url": 0,
        "request.headers": 0,
        "request.params": 0,
        "request.body": 0,
      })
      .sort({ [sortKey]: sortDir == "ASC" ? 1 : -1 })
      .skip(skip)
      .limit(perPage);

    const total = await this.requestLog.countDocuments(condition);

    return { data, total };
  }

  public async findRequest(id: string): Promise<RequestLog> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException();
    }
    return this.requestLog.findById(id);
  }

  public async findAllMongooseLogs(
    filterDto: MonitoringMongoFilterDto,
  ): Promise<MonitoringListResponse<MongooseLog>> {
    const { fromDate, toDate } = this.getFilterDates(filterDto);
    const condition = { createdAt: { $gte: fromDate, $lt: toDate } };
    const { sortDir, collectionName, method } = filterDto;

    if (collectionName) {
      condition["collectionName"] = { $in: collectionName.split(",") };
    }
    if (method) {
      condition["method"] = { $in: method.split(",") };
    }
    const { perPage, skip } = this.getPaginationData(filterDto);
    const sortKey = filterDto.sortKey ?? "createdAt";
    const data = await this.mongooseLog
      .find(condition)
      .select({ __v: 0, updatedAt: 0 })
      .sort({ [sortKey]: sortDir == "ASC" ? 1 : -1 })
      .skip(skip)
      .limit(perPage);

    const total = await this.mongooseLog.countDocuments(condition);

    return { data, total };
  }

  public async findMongooseLog(id: string): Promise<MongooseLog> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException();
    }
    return this.mongooseLog.findById(id);
  }

  public async findMongooseOptions(): Promise<any> {
    const collectionNames = await this.mongooseLog
      .aggregate([{ $project: { collectionName: 1 } }, { $group: { _id: "$collectionName" } }])
      .then((result) => result.map((e) => e._id));

    const methods = await this.mongooseLog
      .aggregate([{ $project: { method: 1 } }, { $group: { _id: "$method" } }])
      .then((result) => result.map((e) => e._id));

    return { collectionNames, methods };
  }

  public async findAllJobs(
    filterDto: MonitoringJobFilterDto,
  ): Promise<MonitoringListResponse<JobLog>> {
    const { fromDate, toDate } = this.getFilterDates(filterDto);
    const condition = { createdAt: { $gte: fromDate, $lt: toDate } };
    const { sortDir, success, name } = filterDto;
    if (name) {
      condition["name"] = { $regex: name, $options: "i" };
    }
    if (success) {
      condition["success"] = JSON.parse(success);
    }
    const { perPage, skip } = this.getPaginationData(filterDto);
    const sortKey = filterDto.sortKey ?? "createdAt";
    const data = await this.jobLog
      .find(condition)
      .select({ __v: 0, updatedAt: 0 })
      .sort({ [sortKey]: sortDir == "ASC" ? 1 : -1 })
      .skip(skip)
      .limit(perPage);

    const total = await this.jobLog.countDocuments(condition);

    return { total, data };
  }

  public async findJobLog(id: string): Promise<JobLog> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException();
    }
    return this.jobLog.findById(id);
  }

  public async analyzeRequests(filterDto: MonitoringBaseFilterDto): Promise<any> {
    const { fromDate, toDate } = this.getFilterDates(filterDto);
    const condition = {
      createdAt: { $gte: fromDate, $lt: toDate },
      "response.statusCode": { $ne: 404 },
    };

    // total requests count
    const total = await this.requestLog.countDocuments(condition);

    // success requests count
    const success = await this.requestLog.countDocuments({
      success: true,
      ...condition,
    });

    // exceptions count
    const exceptions = await this.requestLog.countDocuments({
      ...condition,
      "response.exception": { $exists: true },
    });

    // requests durations
    // requests durations
    let duration: any[] = [];
    try {
      duration = await this.requestLog.aggregate([
        { $match: condition },
        this.durationProjection,
        this.durationBucket,
      ]);
    } catch (error) {
      // error BSON size
      console.log("Analyze with pagination due to large data size...");
      duration = await this.getDurationsWithPagination(condition, total);
    }

    // get requests grouped by end-point (min-max for each group)
    const durations = duration.flatMap((e) => e.data);
    const durationURLs = [];
    const methods = [...new Set(durations.map((obj) => obj.method))];
    [...new Set(durations.map((obj) => `${obj.url}`.split("?")[0]))].forEach((obj) => {
      methods.forEach((method) => {
        const urls = durations.filter(
          (e) => e.statusCode != 404 && `${e.url}`.split("?")[0] == obj && e.method == method,
        );
        const success = urls.filter((e) => e.success == true);
        const min =
          success.length == 0 ? 0 : success.map((e) => e.duration).reduce((a, b) => Math.min(a, b));
        const max =
          success.length == 0 ? 0 : success.map((e) => e.duration).reduce((a, b) => Math.max(a, b));
        const average =
          success.length == 0 ? 0 : success.map((e) => e.duration).reduce((a, b) => a + b);
        if (urls.length > 0) {
          try {
            durationURLs.push({
              method,
              url: obj,
              min,
              max,
              average: average / Math.max(success.length, 1),
              count: success.length,
            });
          } catch (error) {
            console.error(error);
          }
        }
      });
    });

    const createdAt = await this.requestLog.aggregate([
      { $match: condition },
      { $project: { duration: 1, url: 1, method: 1, createdAt: 1 } },
      {
        $bucket: {
          groupBy: "$createdAt",
          boundaries: this.getRange(fromDate, toDate),
          default: toDate,
          output: {
            count: { $sum: 1 },
            data: {
              $push: {
                duration: "$duration",
                method: "$method",
                url: "$url",
                createdAt: "$createdAt",
                success: "$success",
              },
            },
          },
        },
      },
    ]);

    return {
      fromDate,
      toDate,
      total,
      success,
      exceptions,
      duration,
      durationURLs,
      createdAt,
      durationBoundaries: this.durationBoundaries,
    };
  }

  private async getDurationsWithPagination(condition: object, total: number): Promise<any> {
      const pageSize = 100;
      let offset = 0;
      let results = [];
      let hasMore = true;

      while (hasMore) {
          try {
              const duration = await this.requestLog.aggregate([
                  { $match: condition },
                  { $skip: offset },
                  { $limit: pageSize },
                  this.durationProjection,
                  this.durationBucket,
              ]);
              
              results = results.concat(duration);
              if (results.length >= total) {
                  hasMore = false;
              } else {
                  offset += pageSize;
              }
          } catch (_) {
              hasMore = false;
          }
      }

      return results;
  }
}

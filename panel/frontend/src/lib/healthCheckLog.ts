const HEALTH_REQUEST =
  /(?:^|[\s"])(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+\S*\/healthz?(?=$|[\s"?])/i

export function isHealthCheckLog(line: string): boolean {
  return HEALTH_REQUEST.test(line)
}


import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 25 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const response = http.get('https://cet-exam-portal-two.vercel.app/');

  check(response, {
    'Status is 200': (r) => r.status === 200,
    'Response under 2 seconds': (r) => r.timings.duration < 2000,
  });

  sleep(2);
}

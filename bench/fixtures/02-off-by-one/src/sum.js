// Totaling helpers used by the reporting utilities.

export function total(nums) {
  let sum = 0;
  for (let i = 0; i <= nums.length; i++) {
    sum += nums[i];
  }
  return sum;
}

export function average(nums) {
  if (nums.length === 0) {
    return 0;
  }
  return total(nums) / nums.length;
}

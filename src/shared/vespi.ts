export const VESPI_PROFILE = 'vespi'
export const VESPI_RPC_MODE = 'rpc-ui'
export const VESPI_PROFILE_FLAG = '--profile'
export const VESPI_APP_ID = 'com.vespi.desktop'
export const VESPI_PRODUCT_NAME = 'VesPi'
export const VESPI_USER_DATA_ENV = 'VESPI_USER_DATA_DIR'
export const VESPI_WORKSPACE_ENV = 'VESPI_WORKSPACE'
export const VESPI_PRIVATE_OMP_REL = 'runtime/omp/omp.exe'

export function vespiProfileArgs(): string[] {
  return [VESPI_PROFILE_FLAG, VESPI_PROFILE]
}

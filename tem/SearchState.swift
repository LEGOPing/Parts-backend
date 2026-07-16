import SwiftUI
import CoreData
import Combine

// 搜索状态管理对象
class SearchState: ObservableObject {
    @Published var searchText = ""
    @Published var searchResults: [NSManagedObject] = []
    @Published var showResults = false
    @Published var searchType = 0 // 0: 型号, 1: 名称, 2: 颜色ID
    @Published var isLoading = false
    
    // 筛选器状态
    @Published var showFilter = false
    @Published var filterPartNum = ""
    @Published var filterElementId = ""
    @Published var filterPartName = ""
    @Published var filterColorId = ""
    @Published var filterColorName = ""
    @Published var filterCategory = ""
    @Published var filterStatus = -1 // -1: 全部, 0: 旧品, 1: 新品
    @Published var showColorPicker = false
    @Published var availableColors: [(id: Int32, name: String, rgb: String)] = []
    // 颜色选择器状态（支持多选）
    @Published var selectedColors: [Int32] = []
    // 类别选择器状态
    @Published var showCategoryPicker = false
    @Published var availableCategories: [(id: Int32, name: String)] = []
    @Published var selectedCategories: [Int32] = []
    // 类别加载状态
    @Published var partsCountForCategory = 0
    @Published var hasCategoryIds = false
    // 零件型号联想状态
    @Published var showPartNumberSuggestions = false
    @Published var partNumberSuggestions: [PartSuggestion] = []
    @Published var inputBoxFrame: CGRect = .zero
    @Published var designNumberInputFrame: CGRect? = nil
    @Published var partNumberSuggestionPosition: CGPoint? = nil // 存储型号联想器位置
    // 零件名称联想状态
    @Published var showPartNameSuggestions = false
    @Published var partNameSuggestions: [String] = []
    @Published var partNameInputFrame: CGRect? = nil
    @Published var partNameCurrentWordIndex: Int = 0
    @Published var partNameSuggestionPosition: CGPoint? = nil // 存储零件名称联想器位置
    
    // 数量编辑状态
    @Published var showQuantityEdit = false
    @Published var editQuantity: Int32 = 0
    @Published var currentEditingPart: NSManagedObject? = nil
    
    // 缓存
    var colorNameToIdsCache: [String: [Int32]] = [:]
    var elementIdToPartInfoCache: [String: (partNums: [String], colorIds: [Int32])] = [:]
}

// 全局搜索状态对象，确保整个应用程序中只有一个SearchState实例
var globalSearchState = SearchState()
import SwiftUI
import CoreData
import Combine

// 添加零件的状态管理
class AddPartState: ObservableObject {
    // 基本输入字段
    @Published var partNumber: String = ""
    @Published var colorInput: String = ""
    @Published var quantity: String = ""
    @Published var weight: String = ""
    @Published var manualWeightInput: String = ""
    @Published var partWeight: Double? = nil
    @Published var errorMessage: String? = nil
    @Published var isCalculating: Bool = false
    @Published var partName: String = ""
    @Published var colorName: String = ""
    @Published var isNew: Bool = true
    @Published var showColorPicker = false
    @Published var showPartSelector = false
    
    // 零件名称输入和联想功能
    @Published var partNameInput: String = ""
    @Published var showNameSuggestions: Bool = false
    @Published var nameSuggestions: [String] = []
    @Published var currentWordIndex: Int = 0
    
    // 零件型号输入和联想功能
    @Published var showNumberSuggestions: Bool = false
    @Published var numberSuggestions: [PartSuggestion] = []
    @Published var partNumberInputFrame: CGRect = .zero
    @Published var modelGroupFrame: CGRect = .zero
    
    // 临时零件对象（用于AsyncImageLoader）
    @Published var tempPartObject: NSManagedObject? = nil
    // 零件图片URL
    @Published var partImageUrl: String? = nil
    
    // 重量输入相关
    @Published var allowManualWeightInput: Bool = false // 是否允许手动输入重量
    @Published var lastManualWeightInput: String = "" // 最后一次重量输入值
    
    // 定时器变量
    @Published var colorIdTimer: Timer? = nil
    @Published var partNameTimer: Timer? = nil
    @Published var tempPartTimer: Timer? = nil
}
